package `fun`.upup.musicfree.utils; // replace your-apps-package-name with your app’s package name
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowInsets
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import `fun`.upup.musicfree.mpvplayer.MpvServiceBridge
import kotlin.system.exitProcess

class UtilsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    private val reactContext: ReactApplicationContext = context;
    private val exitHandler = Handler(Looper.getMainLooper())

    override fun getName() = "NativeUtils"

    @ReactMethod
    fun exitApp() {
        val activity = reactContext.currentActivity
        if (activity != null) {
            activity.runOnUiThread {
                try {
                    activity.finishAndRemoveTask()
                } catch (_: Throwable) {
                    activity.finishAffinity()
                }
                exitHandler.postDelayed({
                    killCurrentProcess()
                }, 450)
            }
            return
        }
        exitHandler.postDelayed({
            killCurrentProcess()
        }, 450)
    }

    private fun killCurrentProcess() {
        android.os.Process.killProcess(android.os.Process.myPid())
        exitProcess(0)
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val packageName = reactContext.packageName
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        promise.resolve(pm.isIgnoringBatteryOptimizations(packageName))
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val packageName = reactContext.packageName
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:$packageName")

                if (reactContext.currentActivity != null) {
                    reactContext.currentActivity?.startActivity(intent)
                } else {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    reactContext.startActivity(intent)
                }
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject(e)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            if (reactContext.currentActivity != null) {
                reactContext.currentActivity?.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(e)
        }
    }

    @ReactMethod
    fun getPlaybackNativeDiagnostics(promise: Promise) {
        try {
            val processInfo = ActivityManager.RunningAppProcessInfo()
            ActivityManager.getMyMemoryState(processInfo)

            val packageName = reactContext.packageName
            val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val batteryOptimizationIgnored =
                powerManager.isIgnoringBatteryOptimizations(packageName)

            promise.resolve(Arguments.createMap().apply {
                putString("packageName", packageName)
                putDouble("processId", android.os.Process.myPid().toDouble())
                putDouble("checkedAt", System.currentTimeMillis().toDouble())
                putBoolean(
                    "notificationPermission",
                    NotificationManagerCompat.from(reactContext).areNotificationsEnabled()
                )
                putBoolean("batteryOptimizationIgnored", batteryOptimizationIgnored)
                putDouble("appImportance", processInfo.importance.toDouble())
                putString("appImportanceLabel", appImportanceLabel(processInfo.importance))
                // mpv diagnostics live below; the removed Nitro service list is empty.
                putArray("playbackServices", Arguments.createArray())
                putMap("mediaSession", getMediaSessionDiagnostics())
                MpvServiceBridge.artworkStatus?.let { status ->
                    putMap("artwork", Arguments.createMap().apply {
                        putString("state", status.state)
                        status.host?.let { putString("host", it) }
                        putInt("attempt", status.attempt)
                        status.reason?.let { putString("reason", it) }
                        putDouble("updatedAt", status.updatedAt.toDouble())
                    })
                }
            })
        } catch (e: Throwable) {
            promise.reject("playback_native_diagnostics_failed", e)
        }
    }

    /** JS 侧的性能时间点（见 PerfMarks），时间用 JS 记下的墙钟毫秒 */
    @ReactMethod
    fun perfMark(name: String, atMs: Double, detail: String) {
        PerfMarks.mark(name, detail, atMs.toLong())
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getWindowDimensions(): WritableMap {
        val windowManager = reactApplicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val displayMetrics: DisplayMetrics = reactApplicationContext.resources.displayMetrics
        val density = displayMetrics.density

        val windowMetrics = windowManager.currentWindowMetrics
        val insets = windowMetrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars())
        val bounds = windowMetrics.bounds

        val totalWidthPx = bounds.width()
        val totalHeightPx = bounds.height()

        val leftInsetPx = insets.left
        val rightInsetPx = insets.right
        val topInsetPx = insets.top
        val bottomInsetPx = insets.bottom

        val usableWidthPx = totalWidthPx - leftInsetPx - rightInsetPx
        val usableHeightPx = totalHeightPx - topInsetPx - bottomInsetPx

        val usableWidthDp = usableWidthPx / density
        val usableHeightDp = usableHeightPx / density

        return Arguments.createMap().apply {
            putDouble("width", usableWidthDp.toDouble())
            putDouble("height", usableHeightDp.toDouble())
        }
    }

    private fun getMediaSessionDiagnostics(): WritableMap {
        return Arguments.createMap().apply {
            try {
                val mediaSessionManager =
                    reactContext.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
                val sessions = mediaSessionManager.getActiveSessions(null)
                val ownSessions = sessions.filter { it.packageName == reactContext.packageName }
                putString("access", "granted")
                putDouble("activeSessionCount", ownSessions.size.toDouble())
                putBoolean("hasOwnActiveSession", ownSessions.isNotEmpty())
                putArray("playbackStates", Arguments.createArray().apply {
                    ownSessions.forEach { controller ->
                        pushString(playbackStateLabel(controller.playbackState?.state))
                    }
                })
            } catch (e: SecurityException) {
                putString("access", "denied")
                putString("reason", "active MediaSession query requires notification listener or media content control permission")
            } catch (e: Throwable) {
                putString("access", "error")
                putString("reason", e.message ?: e.javaClass.simpleName)
            }
        }
    }

    private fun playbackStateLabel(state: Int?): String {
        return when (state) {
            PlaybackState.STATE_NONE -> "none"
            PlaybackState.STATE_STOPPED -> "stopped"
            PlaybackState.STATE_PAUSED -> "paused"
            PlaybackState.STATE_PLAYING -> "playing"
            PlaybackState.STATE_FAST_FORWARDING -> "fast_forwarding"
            PlaybackState.STATE_REWINDING -> "rewinding"
            PlaybackState.STATE_BUFFERING -> "buffering"
            PlaybackState.STATE_ERROR -> "error"
            PlaybackState.STATE_CONNECTING -> "connecting"
            PlaybackState.STATE_SKIPPING_TO_PREVIOUS -> "skipping_to_previous"
            PlaybackState.STATE_SKIPPING_TO_NEXT -> "skipping_to_next"
            PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM -> "skipping_to_queue_item"
            else -> "unknown"
        }
    }

    private fun appImportanceLabel(importance: Int): String {
        return when (importance) {
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "foreground"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "foreground_service"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE -> "service"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE -> "gone"
            else -> "unknown"
        }
    }
}
