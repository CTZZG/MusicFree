package `fun`.upup.musicfree.utils; // replace your-apps-package-name with your app’s package name
import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowInsets
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import kotlin.system.exitProcess

class UtilsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    private val reactContext: ReactApplicationContext = context;
    private val exitHandler = Handler(Looper.getMainLooper())

    override fun getName() = "NativeUtils"

    @ReactMethod
    fun exitApp() {
        stopMusicFreePlaybackServices()
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

    private fun stopMusicFreePlaybackServices() {
        getPlaybackServiceDefinitions().forEach { (className, shutdownAction) ->
            try {
                val serviceClass = Class.forName(className)
                reactContext.startService(
                    Intent(reactContext, serviceClass).apply {
                        action = shutdownAction
                    }
                )
                exitHandler.postDelayed({
                    try {
                        reactContext.stopService(Intent(reactContext, serviceClass))
                    } catch (_: Throwable) {}
                }, 150)
            } catch (_: Throwable) {
                // Best effort: process kill below is the hard stop.
            }
        }
    }

    /**
     * 退出时需要额外广播关闭的播放服务（类名, 关闭 action）。
     *
     * Nitro 播放后端移除后这里为空：mpv 的前台服务由
     * stopMusicFreePlaybackServices 之外的路径直接 stopService，不需要反射。
     * 保留这个结构是因为退出流程的其余部分依赖它遍历，且未来若再引入
     * 第三方播放服务可直接登记。
     */
    private fun getPlaybackServiceDefinitions(): List<Pair<String, String>> =
        emptyList()

    private fun killCurrentProcess() {
        android.os.Process.killProcess(android.os.Process.myPid())
        exitProcess(0)
    }

    @ReactMethod
    fun checkStoragePermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            promise.resolve(Environment.isExternalStorageManager())
        } else {
            val readPermission = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            val writePermission = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            promise.resolve(readPermission && writePermission)
        }
    }

    @ReactMethod
    fun requestStoragePermission() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                data = Uri.parse("package:${reactContext.packageName}")
            }
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${reactContext.packageName}")
            }
        }
        reactContext.currentActivity?.startActivity(intent)
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val packageName = reactContext.packageName
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(packageName))
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
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
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
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
        } else {
            promise.resolve(true)
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
                Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
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
                putArray("playbackServices", getPlaybackServiceDiagnostics())
                putMap("mediaSession", getMediaSessionDiagnostics())
            })
        } catch (e: Throwable) {
            promise.reject("playback_native_diagnostics_failed", e)
        }
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getWindowDimensions(): WritableMap {
        val windowManager = reactApplicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val displayMetrics: DisplayMetrics = reactApplicationContext.resources.displayMetrics
        val density = displayMetrics.density

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11 (API 30) 及以上使用新 API
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

            Arguments.createMap().apply {
                putDouble("width", usableWidthDp.toDouble())
                putDouble("height", usableHeightDp.toDouble())
            }
        } else {
            // Android 10 及以下使用旧 API
            val display = windowManager.defaultDisplay
            val realSize = android.graphics.Point()
            display.getRealSize(realSize)

            // 获取状态栏和导航栏高度
            val resources = reactApplicationContext.resources
            var statusBarHeight = 0
            var navigationBarHeight = 0

            // 状态栏高度
            val statusBarResourceId = resources.getIdentifier("status_bar_height", "dimen", "android")
            if (statusBarResourceId > 0) {
                statusBarHeight = resources.getDimensionPixelSize(statusBarResourceId)
            }

            // 导航栏高度
            val navigationBarResourceId = resources.getIdentifier("navigation_bar_height", "dimen", "android")
            if (navigationBarResourceId > 0) {
                navigationBarHeight = resources.getDimensionPixelSize(navigationBarResourceId)
            }

            val usableWidthPx = realSize.x
            val usableHeightPx = realSize.y - statusBarHeight - navigationBarHeight

            val usableWidthDp = usableWidthPx / density
            val usableHeightDp = usableHeightPx / density

            Arguments.createMap().apply {
                putDouble("width", usableWidthDp.toDouble())
                putDouble("height", usableHeightDp.toDouble())
            }
        }
    }

    private fun getPlaybackServiceDiagnostics(): WritableArray {
        val result = Arguments.createArray()
        getPlaybackServiceDefinitions().forEach { (className, shutdownAction) ->
            result.pushMap(Arguments.createMap().apply {
                putString("className", className)
                putString("shutdownAction", shutdownAction)
                putBoolean("declared", isServiceDeclared(className))
                putBoolean("running", isServiceRunning(className))
            })
        }
        return result
    }

    private fun isServiceDeclared(className: String): Boolean {
        return try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.packageManager.getPackageInfo(
                    reactContext.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_SERVICES.toLong())
                )
            } else {
                @Suppress("DEPRECATION")
                reactContext.packageManager.getPackageInfo(
                    reactContext.packageName,
                    PackageManager.GET_SERVICES
                )
            }
            packageInfo.services?.any { it.name == className } == true
        } catch (_: Throwable) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun isServiceRunning(className: String): Boolean {
        return try {
            val activityManager = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            activityManager.getRunningServices(Int.MAX_VALUE).any {
                it.service.className == className
            }
        } catch (_: Throwable) {
            false
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
