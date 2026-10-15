package `fun`.upup.musicfree
import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import `fun`.upup.musicfree.utils.PerfMarks

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MusicFree"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

  // 性能基线：等开屏页拿掉后的那一帧（见 HomeDrawnWatcher），Activity 销毁时停
  private var homeDrawnWatcher: HomeDrawnWatcher? = null

  // https://reactnavigation.org/docs/getting-started/#installing-dependencies-into-a-bare-react-native-project
  override fun onCreate(savedInstanceState: Bundle?) {
      SplashScreenManager.registerOnActivity(this)
      super.onCreate(null);
      markFirstDraw()
      // 重建（转屏、换深浅色等）时系统不会交开屏页过来，不用等
      if (savedInstanceState == null) {
          homeDrawnWatcher = HomeDrawnWatcher.start(window)
      }
  }

  override fun onDestroy() {
      homeDrawnWatcher?.stop()
      homeDrawnWatcher = null
      super.onDestroy()
  }

  /**
   * 性能基线：记下应用窗口第一次出帧的时刻。开屏页撑着时窗口照常出帧、内容先藏着，开屏页交给应用后
   * 盖在最上面，JS 叫收起后内容显示、开屏页淡出（见 patches/expo-splash-screen+56.0.14.patch）。
   * 用户看到主页以开屏页拿掉后的第一帧交给系统合成为准（见 HomeDrawnWatcher、utils/PerfMarks、e2e/perf.sh、
   * e2e/lib/perf_stats.py）
   */
  private fun markFirstDraw() {
      val content = findViewById<View>(android.R.id.content) ?: return
      content.viewTreeObserver.addOnDrawListener(object : ViewTreeObserver.OnDrawListener {
          private var marked = false

          override fun onDraw() {
              if (marked) return
              marked = true
              PerfMarks.mark("first-draw")
              // onDraw 里不能移除监听，放到下一轮
              content.post { content.viewTreeObserver.removeOnDrawListener(this) }
          }
      })
  }

  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      setIntent(intent)
  }

  /**
   * 性能基线：开屏页（系统交给应用的 SplashScreenView，挂在 decor 下面）从窗口里拿掉之后的第一帧，画好交给系统
   * 合成的时刻，才是用户看到主页的时刻（记 home-drawn）。主线程画完这一帧不等于它上了屏：渲染线程还在画前面的帧时
   * （比如主页第一次画，模拟器的软件渲染要一两秒），屏幕上一直是开屏页（Beta #150、#152 的冷启动追踪截屏）。
   * 回调在主线程跑，主线程正忙时会再晚一点。只在 API 31 起记（之前的开屏页不是 SplashScreenView）。
   *
   * 每帧画之前看一眼 decor 下面有没有开屏页。等到开屏页来了又走了就停；没有开屏页交过来时（系统这次没显示开屏页）
   * 最多等 WAIT_MS；Activity 销毁时也停（stop）
   */
  private class HomeDrawnWatcher private constructor(
      private val decor: ViewGroup,
  ) : ViewTreeObserver.OnPreDrawListener {
      private var sawSplash = false
      private var watching = true
      private val giveUp = Runnable { stop() }

      override fun onPreDraw(): Boolean {
          // 按类名比，不直接引用 API 31 的类
          val splashShown = (0 until decor.childCount).any {
              decor.getChildAt(it).javaClass.name == "android.window.SplashScreenView"
          }
          if (splashShown) {
              sawSplash = true
          } else if (sawSplash) {
              stop()
              // 在这一帧画之前登记，系统合成拿到这一帧时回调
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  decor.viewTreeObserver.registerFrameCommitCallback { PerfMarks.mark("home-drawn") }
              }
          }
          return true
      }

      fun stop() {
          if (!watching) return
          watching = false
          decor.removeCallbacks(giveUp)
          decor.viewTreeObserver.removeOnPreDrawListener(this)
      }

      companion object {
          // 冷启动到开屏页拿掉，Beta 的模拟器上也在 5 秒内；这么久还没等到就不等了
          private const val WAIT_MS = 15_000L

          fun start(window: Window): HomeDrawnWatcher? {
              if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
              val decor = window.decorView as? ViewGroup ?: return null
              return HomeDrawnWatcher(decor).also {
                  decor.viewTreeObserver.addOnPreDrawListener(it)
                  decor.postDelayed(it.giveUp, WAIT_MS)
              }
          }
      }
  }
}
