package `fun`.upup.musicfree.utils

import android.app.Activity
import android.app.Application
import android.content.pm.ActivityInfo
import android.view.WindowInsetsController
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE, application = Application::class)
class VideoFullscreenSessionTest {
    @Test fun landscapeIsScopedAndRestoresThePreviousActivityPolicy() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        val session = VideoFullscreenSession()
        session.enter(activity)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, activity.requestedOrientation)
        session.enter(activity) // Reentry must not replace the original snapshot.
        session.exit()
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, activity.requestedOrientation)
        session.exit()
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, activity.requestedOrientation)
        controller.pause().stop().destroy()
    }

    @Test fun switchingActivitiesReleasesTheOldLeaseAndKeepsEachOriginalOrientation() {
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        val second = Robolectric.buildActivity(Activity::class.java).setup()
        first.get().requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        second.get().requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
        val session = VideoFullscreenSession()
        session.enter(first.get())
        session.enter(second.get())
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, first.get().requestedOrientation)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, second.get().requestedOrientation)
        session.exit()
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR, second.get().requestedOrientation)
        second.pause().stop().destroy()
        first.pause().stop().destroy()
    }

    @Test fun transientBarsAreScopedToFullscreenAndDestroyedActivitiesAreSafe() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val bars = requireNotNull(activity.window.insetsController)
        bars.systemBarsBehavior = WindowInsetsController.BEHAVIOR_DEFAULT
        val session = VideoFullscreenSession()
        session.enter(activity)
        assertEquals(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE, bars.systemBarsBehavior)
        session.exit()
        assertEquals(WindowInsetsController.BEHAVIOR_DEFAULT, bars.systemBarsBehavior)
        session.enter(activity)
        controller.pause().stop().destroy()
        session.exit()
        session.exit()
    }
}
