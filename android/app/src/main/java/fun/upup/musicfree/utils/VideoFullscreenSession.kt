package `fun`.upup.musicfree.utils

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.WindowInsets
import android.view.WindowInsetsController
import java.lang.ref.WeakReference

/** Main-thread, presentation-only lease. Never touches the player or system rotation settings. */
internal class VideoFullscreenSession {
    private data class Saved(
        val activity: WeakReference<Activity>,
        val orientation: Int,
        val navigationVisible: Boolean,
        val barsBehavior: Int,
    )
    private var saved: Saved? = null

    fun enter(activity: Activity) {
        if (saved?.activity?.get() !== activity) {
            exit()
            val window = activity.window
            saved = Saved(
                WeakReference(activity),
                activity.requestedOrientation,
                window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.navigationBars()) ?: true,
                window.insetsController?.systemBarsBehavior ?: WindowInsetsController.BEHAVIOR_DEFAULT,
            )
        }
        // An explicit fullscreen button must also work when auto-rotate is disabled.
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        activity.window.insetsController?.apply {
            systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsets.Type.navigationBars())
        }
    }

    fun exit() {
        val previous = saved ?: return
        saved = null
        val activity = previous.activity.get()?.takeUnless { it.isDestroyed } ?: return
        activity.requestedOrientation = previous.orientation
        activity.window.insetsController?.apply {
            systemBarsBehavior = previous.barsBehavior
            if (previous.navigationVisible) show(WindowInsets.Type.navigationBars())
            else hide(WindowInsets.Type.navigationBars())
        }
    }
}
