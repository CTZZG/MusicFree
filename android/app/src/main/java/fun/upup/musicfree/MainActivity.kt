package `fun`.upup.musicfree
import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewTreeObserver
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

  // https://reactnavigation.org/docs/getting-started/#installing-dependencies-into-a-bare-react-native-project
  override fun onCreate(savedInstanceState: Bundle?) {
      SplashScreenManager.registerOnActivity(this)
      super.onCreate(null);
      markFirstDraw()
  }

  /**
   * 性能基线：开屏页撑着的时候界面不画（见 SplashScreenManager 的 OnPreDrawListener），
   * 这里记下内容第一次画出来的时刻。这时开屏页还盖着：系统等这一帧同步完（Displayed）才把开屏页
   * 交给应用移除，用户看到主页以开屏页移除为准（见 utils/PerfMarks、e2e/perf.sh、e2e/lib/perf_stats.py）
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
}
