package `fun`.upup.musicfree.mpvplayer

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import com.facebook.react.common.LifecycleState
import dev.jdtech.mpv.MPVLib as NativeMPVLib
import `fun`.upup.musicfree.bridge.CancelablePromise
import `fun`.upup.musicfree.utils.PerfMarks
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/**
 * mpv single-track playback engine.
 *
 * JS owns queue/order/repeat. Native owns only libmpv, MediaSession-facing
 * metadata, progress and remote command events. Loading is guarded by a
 * generation counter so stale END_FILE events from replacing the old file do
 * not look like a natural track end.
 */
@ReactModule(name = MpvPlayerModule.NAME)
class MpvPlayerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    NativeMPVLib.EventObserver {

    private val isInitialized = AtomicBoolean(false)
    private val invalidated = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var mpvInstance: NativeMPVLib? = null
    private val pendingMainTasks =
        ConcurrentHashMap.newKeySet<PendingMainTask>()
    private val activePromises =
        ConcurrentHashMap.newKeySet<CancelablePromise>()

    private inner class PendingMainTask(
        private val promise: CancelablePromise,
        private val cancellationCode: String,
        private val action: () -> Unit,
    ) : Runnable {
        override fun run() {
            pendingMainTasks.remove(this)
            if (invalidated.get()) {
                promise.cancel()
                return
            }
            try {
                action()
            } catch (error: Throwable) {
                promise.reject(
                    cancellationCode,
                    "MPV operation failed unexpectedly",
                    error,
                )
            }
        }

        fun cancel() {
            if (!pendingMainTasks.remove(this)) {
                return
            }
            mainHandler.removeCallbacks(this)
            promise.cancel()
        }
    }

    private fun controlledPromise(
        promise: Promise,
        cancellationCode: String,
    ): CancelablePromise {
        val controlled = CancelablePromise(
            promise,
            cancellationCode,
            "MPV operation was cancelled",
        ) {
            activePromises.remove(it)
        }
        activePromises.add(controlled)
        if (invalidated.get()) {
            controlled.cancel()
        }
        return controlled
    }

    private fun postPromise(
        promise: Promise,
        cancellationCode: String,
        action: (Promise) -> Unit,
    ) {
        val controlled = controlledPromise(promise, cancellationCode)
        if (invalidated.get()) {
            controlled.cancel()
            return
        }
        val task = PendingMainTask(controlled, cancellationCode) {
            action(controlled)
        }
        pendingMainTasks.add(task)
        if (!mainHandler.post(task)) {
            task.cancel()
        }
    }

    @Suppress("PropertyName")
    private val MPVLib = MpvCompat()

    private fun requireMpv(): NativeMPVLib =
        mpvInstance ?: throw IllegalStateException("mpv is not initialized")

    private inner class MpvCompat {
        val MPV_FORMAT_FLAG = NativeMPVLib.MpvFormat.MPV_FORMAT_FLAG
        val MPV_FORMAT_DOUBLE = NativeMPVLib.MpvFormat.MPV_FORMAT_DOUBLE
        val MPV_FORMAT_STRING = NativeMPVLib.MpvFormat.MPV_FORMAT_STRING

        val MPV_EVENT_START_FILE = NativeMPVLib.MpvEvent.MPV_EVENT_START_FILE
        val MPV_EVENT_FILE_LOADED = NativeMPVLib.MpvEvent.MPV_EVENT_FILE_LOADED
        val MPV_EVENT_PLAYBACK_RESTART = NativeMPVLib.MpvEvent.MPV_EVENT_PLAYBACK_RESTART
        val MPV_EVENT_END_FILE = NativeMPVLib.MpvEvent.MPV_EVENT_END_FILE
        val MPV_EVENT_SHUTDOWN = NativeMPVLib.MpvEvent.MPV_EVENT_SHUTDOWN

        fun create(context: Context) {
            mpvInstance?.let { oldInstance ->
                try {
                    oldInstance.destroy()
                } finally {
                    mpvInstance = null
                }
            }
            mpvInstance = NativeMPVLib.create(context)
                ?: throw IllegalStateException("failed to create mpv instance")
        }

        fun init() = requireMpv().init()

        fun destroy() {
            mpvInstance?.let { instance ->
                try {
                    instance.destroy()
                } finally {
                    mpvInstance = null
                }
            }
        }

        fun command(command: Array<String>) = requireMpv().command(command)

        fun setOptionString(name: String, value: String): Int =
            requireMpv().setOptionString(name, value)

        fun getPropertyInt(property: String): Int? =
            mpvInstance?.getPropertyInt(property)

        fun setPropertyInt(property: String, value: Int) =
            requireMpv().setPropertyInt(property, value)

        fun getPropertyDouble(property: String): Double? =
            mpvInstance?.getPropertyDouble(property)

        fun setPropertyDouble(property: String, value: Double) =
            requireMpv().setPropertyDouble(property, value)

        fun getPropertyBoolean(property: String): Boolean? =
            mpvInstance?.getPropertyBoolean(property)

        fun setPropertyBoolean(property: String, value: Boolean) =
            requireMpv().setPropertyBoolean(property, value)

        fun getPropertyString(property: String): String? =
            mpvInstance?.getPropertyString(property)

        fun setPropertyString(property: String, value: String) =
            requireMpv().setPropertyString(property, value)

        fun observeProperty(property: String, format: Int) =
            requireMpv().observeProperty(property, format)

        fun addObserver(observer: NativeMPVLib.EventObserver) =
            requireMpv().addObserver(observer)

        fun removeObserver(observer: NativeMPVLib.EventObserver) =
            mpvInstance?.removeObserver(observer)
    }

    private data class PreparedTrack(
        val url: String,
        val mediaId: String,
        val loadGeneration: Long,
        val prepareToken: Long,
        val queueRevision: Long,
        val title: String,
        val artist: String,
        val album: String,
        val artwork: String?,
        val duration: Double,
        val sourceMediaId: String? = null,
        val sourceLoadGeneration: Long? = null,
    )

    /**
     * 批量预备时，除「即将提升的下一首」外的后续曲目。它们不会立即进入 mpv
     * playlist——只有在前一首成功提升后，才会被原生自动接续追加，复用与单曲
     * prepareNext 完全相同的追加/校验路径。这样任意时刻 mpv playlist 里最多
     * 只有一个「已追加但未提升」的曲目，promotePreparedTrack/END_FILE/START_FILE
     * 那套单槽状态机不需要改动。
     */
    private data class QueuedPrepareEntry(
        val prepared: PreparedTrack,
        val headerString: String,
        val userAgent: String?,
    )

    private data class TrackIdentity(
        val url: String,
        val mediaId: String,
        val loadGeneration: Long,
        val prepareToken: Long,
        val queueRevision: Long,
    )

    private data class PendingNaturalEnd(
        val serial: Long,
        val endedIdentity: TrackIdentity?,
        val videoEndIdentity: TrackIdentity?,
        val endedKind: String = "audio",
    )

    private var positionSecs = 0.0
    private var durationSecs = 0.0
    private var cacheAheadSecs = 0.0
    private var currentState = "idle"

    @Volatile private var currentLoadGeneration = 0L
    private val engineProgressMarker = EngineProgressMarker()
    @Volatile private var activeTrackIdentity: TrackIdentity? = null
    // Accepted native MV load ownership also covers loading/failure, before
    // FILE_LOADED can confirm active identity. Only explicit zero/return may
    // replace it; preserve-MV still requires a live outgoing file/clock.
    private var ownedVideoIdentity: TrackIdentity? = null
    private var ownedAudioReturnIdentity: TrackIdentity? = null
    private var audioReturnPosition: Double? = null
    private var outgoingAudioPosition: Double? = null
    @Volatile private var renditionTrackingEnabled = false
    private var readyGeneration = -1L
    private var failedAudioReturnGeneration = -1L
    private var videoNetworkPolicy: String? = null
    private val connectivity by lazy { reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private fun videoNetworkAllowed(policy: String? = videoNetworkPolicy): Boolean {
        if (policy == null) return true
        val caps = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
            (policy == "allow-metered" || caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
    }

    private fun watchVideoNetwork() {
        if (networkCallback != null) return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = check()
            override fun onLost(network: Network) = check()
            private fun check() {
                mainHandler.post {
                    if (isInitialized.get() && renditionKind == "mv" && !videoNetworkAllowed()) {
                        keepHeldPaused("video-network")
                    }
                }
            }
        }
        connectivity.registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }
    // Only a confirmed, unpromoted MV END_FILE owns a return/restart after mpv
    // has removed its path/time-pos. Never infer ownership from an idle player.
    private var completedVideoIdentity: TrackIdentity? = null
    private var loadingTrackIdentity: TrackIdentity? = null
    private var loadingGeneration = -1L
    private val pendingUnpause = PendingUnpause()
    private var ignoreEndFileUntilMs = 0L
    private var suppressIdleUntilMs = 0L
    private var stopRequested = false
    private val pendingSeek = PendingSeek()

    private var defaultUserAgent: String? = null
    private var cachedTitle = ""
    private var cachedArtist = ""
    private var cachedAlbum = ""
    private var cachedArtwork: String? = null
    private var progressIntervalMs = 1000L
    private var lastProgressEmitMs = 0L
    private var preparedTrack: PreparedTrack? = null
    private var hasPlaylistPreparedTrack = false
    private var preparedPlaylistIndex = -1
    /** prepareNextBatch 里排在第二首之后、还没被追加进 mpv playlist 的预备曲目。 */
    private var pendingPreparedQueue: MutableList<QueuedPrepareEntry> = mutableListOf()
    private var pendingPlaylistCompaction = false
    private var pendingNaturalEnd: PendingNaturalEnd? = null
    private var naturalEndSerial = 0L
    private var androidAutoConnectionDetector: MpvAndroidAutoConnectionDetector? = null
    private var isAndroidAutoConnected = false
    private var renditionKind = "audio"
    private val videoOutput = MpvVideoOutput(
        player = { mpvInstance },
        accepts = { mediaId, generation ->
            !invalidated.get() && generation == currentLoadGeneration &&
                mediaId == (loadingTrackIdentity ?: activeTrackIdentity)?.mediaId
        },
        canRender = { mediaId, generation ->
            renditionKind == "mv" && loadingTrackIdentity == null &&
                activeTrackIdentity?.let {
                    it.mediaId == mediaId && it.loadGeneration == generation && currentPathMatches(it.url)
                } == true
        },
        onError = {
            sendEvent(ON_MPV_ERROR, Arguments.createMap().apply {
                putString("message", "Video output unavailable")
                putString("code", "video-output-unavailable")
            })
        },
    )

    internal fun updateVideoSurface(owner: Long, mediaId: String, generation: Long, surface: Surface, width: Int, height: Int) =
        videoOutput.update(owner, mediaId, generation, surface, width, height)

    internal fun releaseVideoSurface(owner: Long) = videoOutput.release(owner)

    internal fun ownsVideoSurface(owner: Long, mediaId: String, generation: Long): Boolean =
        videoOutput.owns(owner, mediaId, generation)

    companion object {
        const val NAME = "MpvPlayer"
        private const val TAG = "MpvPlayerModule"
        private const val ON_MPV_STATE_CHANGED = "onMpvStateChanged"
        private const val ON_MPV_PROGRESS = "onMpvProgress"
        private const val ON_MPV_ENDED = "onMpvEnded"
        private const val ON_MPV_ACTIVE_TRACK_CHANGED = "onMpvActiveTrackChanged"
        private const val ON_MPV_ERROR = "onMpvError"
        private const val ON_MPV_REMOTE_COMMAND = "onMpvRemoteCommand"
        private const val ON_MPV_BROWSE_REQUEST = "onMpvBrowseRequest"
        private const val ON_MPV_ANDROID_AUTO_CONNECTION_CHANGED =
            "onMpvAndroidAutoConnectionChanged"
        /** mpv 解复用缓存的内存上限（纯音频足够用，且与磁盘缓存设置无关） */
        private const val MAX_DEMUXER_BYTES = 32L * 1024 * 1024
        /** 已播放部分的回看缓存上限，避免长曲目把内存堆起来 */
        private const val MAX_DEMUXER_BACK_BYTES = 8L * 1024 * 1024
        private const val END_FILE_SUPPRESS_MS = 1200L
        private const val NATURAL_END_DEDUP_MS = 350L
        private val PLAYLIST_COMPACT_DELAYS_MS = longArrayOf(0L, 120L, 500L)
        private val PREPARED_PROMOTION_RETRY_DELAYS_MS =
            longArrayOf(0L, 24L, 80L, 220L, 600L, 1200L)
        private val UNPAUSE_RETRY_DELAYS_MS = longArrayOf(0L, 80L, 250L, 700L)
    }

    override fun getName() = NAME

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required by NativeEventEmitter.
    }

    private fun sendEvent(name: String, params: WritableMap?) {
        if (name == ON_MPV_ERROR && params != null) putEventIdentity(params)
        if (invalidated.get()) return
        reactContext.getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(name, params ?: Arguments.createMap())
    }

    private fun runMpvCallbackOnMain(action: () -> Unit) {
        val task = Runnable {
            if (isInitialized.get() && !invalidated.get()) {
                action()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            task.run()
        } else {
            mainHandler.post(task)
        }
    }

    private fun runOwnedPropertyOnMain(action: () -> Unit) {
        val generation = currentLoadGeneration
        runMpvCallbackOnMain {
            if (!renditionTrackingEnabled || generation == currentLoadGeneration) action()
        }
    }

    private fun startPlaybackService(foreground: Boolean) {
        val intent = Intent(reactContext, MpvPlaybackService::class.java).apply {
            if (foreground) {
                action = MpvPlaybackService.ACTION_START_FOREGROUND
            }
        }
        try {
            if (foreground) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
        } catch (e: Exception) {
            Log.w(TAG, "start playback service failed", e)
        }
    }

    private fun emitState(state: String, force: Boolean = false) {
        if (!force && currentState == state) return
        currentState = state
        sendEvent(
            ON_MPV_STATE_CHANGED,
            Arguments.createMap().apply { putString("state", state); putEventIdentity(this) },
        )
        MpvServiceBridge.service?.onPlaybackStateChanged(state)
    }

    private fun putEventIdentity(map: WritableMap) {
        val identity = loadingTrackIdentity ?: activeTrackIdentity
        map.putString("mediaId", identity?.mediaId)
        map.putDouble("loadGeneration", currentLoadGeneration.toDouble())
        map.putString("renditionKind", renditionKind)
    }

    private fun bufferedPositionSecs(): Double {
        if (durationSecs <= 0) {
            return max(positionSecs, positionSecs + cacheAheadSecs)
        }
        return min(durationSecs, max(positionSecs, positionSecs + cacheAheadSecs))
    }

    private fun emitProgress(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastProgressEmitMs < progressIntervalMs) {
            return
        }
        lastProgressEmitMs = now

        val identity = activeTrackIdentity
        val readyRaw = if (renditionTrackingEnabled && readyGeneration == currentLoadGeneration &&
            loadingTrackIdentity == null && identity?.loadGeneration == currentLoadGeneration &&
            currentPathMatches(identity.url)) {
            MPVLib.getPropertyDouble("time-pos")?.takeIf { it.isFinite() && it >= 0.0 }
        } else null
        if (readyRaw != null) positionSecs = readyRaw

        val bufferedSecs = bufferedPositionSecs()
        sendEvent(
            ON_MPV_PROGRESS,
            Arguments.createMap().apply {
                putDouble("position", positionSecs)
                putDouble("duration", durationSecs)
                putDouble("buffered", bufferedSecs)
                putBoolean("ready", readyRaw != null)
                putEventIdentity(this)
            },
        )
        MpvServiceBridge.service?.onProgressChanged(
            positionSecs,
            durationSecs,
            bufferedSecs,
        )
    }

    private fun syncMetadata(service: MpvPlaybackService? = MpvServiceBridge.service) {
        service?.onMetadataChanged(
            cachedTitle,
            cachedArtist,
            cachedAlbum,
            cachedArtwork,
            durationSecs,
        )
    }

    private val serviceReadyCallback: (MpvPlaybackService) -> Unit = { service ->
        runMpvCallbackOnMain {
            if (MpvServiceBridge.service === service &&
                (activeTrackIdentity != null || loadingTrackIdentity != null)
            ) {
                // Reconcile only the service. Do not resend a JS state event,
                // claim an external hold, or change the engine's pause/seek state.
                syncMetadata(service)
                service.onProgressChanged(positionSecs, durationSecs, bufferedPositionSecs())
                service.onPlaybackStateChanged(currentState)
                Log.d(TAG, "playback service ready; state=$currentState")
            }
        }
    }

    // Normal initialization and resource release share the main looper.
    private fun detachServiceReadyCallback() {
        if (MpvServiceBridge.onServiceReady === serviceReadyCallback) {
            MpvServiceBridge.onServiceReady = null
        }
    }

    private fun setAndroidAutoConnected(connected: Boolean, force: Boolean = false) {
        if (!force && isAndroidAutoConnected == connected) return
        isAndroidAutoConnected = connected
        MpvServiceBridge.isAndroidAutoConnected = connected
        MpvServiceBridge.service?.onCarLyricStateChanged()
        sendEvent(
            ON_MPV_ANDROID_AUTO_CONNECTION_CHANGED,
            Arguments.createMap().apply { putBoolean("connected", connected) },
        )
    }

    private fun registerAndroidAutoConnectionDetector() {
        if (androidAutoConnectionDetector != null) return

        androidAutoConnectionDetector =
            MpvAndroidAutoConnectionDetector(reactContext.applicationContext).apply {
                onConnectionChanged = { connected, _ ->
                    mainHandler.post {
                        if (!invalidated.get()) {
                            setAndroidAutoConnected(connected)
                        }
                    }
                }
                register()
            }
    }

    private fun unregisterAndroidAutoConnectionDetector(
        notifyJs: Boolean = true,
    ) {
        androidAutoConnectionDetector?.onConnectionChanged = null
        androidAutoConnectionDetector?.unregister()
        androidAutoConnectionDetector = null
        if (notifyJs && !invalidated.get()) {
            setAndroidAutoConnected(false)
        } else {
            isAndroidAutoConnected = false
            MpvServiceBridge.isAndroidAutoConnected = false
        }
    }

    private fun readString(map: ReadableMap, key: String): String? =
        if (map.hasKey(key) && !map.isNull(key)) map.getString(key) else null

    private fun readDouble(map: ReadableMap, key: String): Double? =
        if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null

    private fun readBoolean(map: ReadableMap, key: String): Boolean? =
        if (map.hasKey(key) && !map.isNull(key)) map.getBoolean(key) else null

    private fun readLong(map: ReadableMap, key: String): Long? =
        readDouble(map, key)?.takeIf { !it.isNaN() && !it.isInfinite() }?.toLong()

    private fun readHeaders(map: ReadableMap?): Map<String, String> {
        if (map == null) {
            return emptyMap()
        }
        val result = mutableMapOf<String, String>()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val rawKey = iterator.nextKey()
            val key = rawKey.trim()
            val value = readString(map, rawKey)?.trim()
            if (key.isNotBlank() && !value.isNullOrBlank()) {
                result[key] = value
            }
        }
        return result
    }

    private fun readDuckMode(options: ReadableMap): String =
        readString(options, "remoteDuckMode")
            ?.takeIf { it == "pause" || it == "lowerVolume" }
            ?: "pause"

    private fun readDuckVolume(options: ReadableMap): Double =
        (readDouble(options, "remoteDuckVolume") ?: 0.5)
            .takeIf { !it.isNaN() && !it.isInfinite() }
            ?.coerceIn(0.0, 1.0)
            ?: 0.5

    private fun readProgressIntervalMs(options: ReadableMap): Long {
        val raw = readDouble(options, "progressIntervalMs") ?: 1000.0
        if (raw.isNaN() || raw.isInfinite() || raw <= 0) {
            return 1000L
        }

        // RN player configs commonly pass seconds, e.g. 0.1 means 100 ms.
        val millis = if (raw < 10.0) raw * 1000.0 else raw
        return millis.toLong().coerceIn(100L, 5000L)
    }

    private fun validDuration(value: Double?): Double =
        if (value != null && !value.isNaN() && !value.isInfinite() && value > 0) {
            value
        } else {
            0.0
        }

    /** [seekingTo] 是刚发出的跳转目标：mpv 还没跳过去，这时读到的 time-pos 是 0，不能用 */
    private fun updateDurationFromMpv(seekingTo: Double? = null) {
        try {
            val nativeDuration = validDuration(MPVLib.getPropertyDouble("duration"))
            if (nativeDuration > 0) {
                durationSecs = nativeDuration
                syncMetadata()
            }
            val nativePosition = MPVLib.getPropertyDouble("time-pos")
            if (seekingTo != null) {
                positionSecs = seekingTo
            } else if (nativePosition != null && !nativePosition.isNaN() && nativePosition >= 0) {
                positionSecs = nativePosition
            }
            emitProgress(force = true)
        } catch (e: Exception) {
            Log.d(TAG, "updateDurationFromMpv ignored", e)
        }
    }

    private fun markLoading(autoPlay: Boolean, requestedGeneration: Long): Long {
        readyGeneration = -1L
        failedAudioReturnGeneration = -1L
        val generation = requestedGeneration
        currentLoadGeneration = generation
        loadingGeneration = generation
        if (autoPlay) {
            pendingUnpause.arm(generation)
        } else {
            pendingUnpause.cancel()
        }
        val now = System.currentTimeMillis()
        ignoreEndFileUntilMs = now + END_FILE_SUPPRESS_MS
        suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
        stopRequested = false
        pendingSeek.reset()
        return generation
    }

    private fun emitActiveTrackChanged(identity: TrackIdentity, source: String) {
        sendEvent(
            ON_MPV_ACTIVE_TRACK_CHANGED,
            Arguments.createMap().apply {
                putString("mediaId", identity.mediaId)
                putDouble("loadGeneration", identity.loadGeneration.toDouble())
                putDouble("prepareToken", identity.prepareToken.toDouble())
                putDouble("queueRevision", identity.queueRevision.toDouble())
                putString("source", source)
                putString("renditionKind", renditionKind)
            },
        )
    }

    private fun normalizedMediaPath(value: String?): String? =
        value
            ?.takeIf { it.isNotBlank() }
            ?.removePrefix("file://")
            ?.let(Uri::decode)

    private fun currentPathMatches(url: String): Boolean {
        val currentPath = try {
            MPVLib.getPropertyString("path")
        } catch (_: Exception) {
            null
        }
        return normalizedMediaPath(currentPath) == normalizedMediaPath(url)
    }

    private fun isCurrentGeneration(generation: Long): Boolean =
        generation == currentLoadGeneration

    /**
     * 外部暂停、系统打断着（见 [PlaybackHold]）：撤销排着的自动取消暂停，停在暂停。
     * 装载完成、恢复播放、播放服务收到外部暂停时都可能走到这里。
     */
    private fun keepHeldPaused(reason: String) {
        pendingUnpause.cancel()
        try {
            MPVLib.setPropertyBoolean("pause", true)
        } catch (e: Exception) {
            Log.w(TAG, "keepHeldPaused failed", e)
        }
        if (currentState == "playing" || currentState == "buffering") {
            emitState("paused")
        }
        Log.d(TAG, "autoplay held ($reason): ${MpvServiceBridge.playbackHold}")
    }

    private fun emitError(code: String, message: String) {
        emitState("error")
        sendEvent(ON_MPV_ERROR, Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
        })
    }

    private fun forceUnpause(generation: Long) {
        // 排着的重试在明确暂停之后照样会到点执行：撤销过就什么都不做（见 PendingUnpause）
        if (
            !isCurrentGeneration(generation) ||
            stopRequested ||
            pendingSeek.isPendingFor(generation) ||
            !pendingUnpause.isArmedFor(generation)
        ) {
            return
        }
        // 外部暂停、系统打断着：这一代就算还排着自动播放，也不能放出来
        if (MpvServiceBridge.playbackHold.blocksAutoPlay || (renditionKind == "mv" && !videoNetworkAllowed())) {
            keepHeldPaused("unpause")
            return
        }
        val identity = loadingTrackIdentity
            ?.takeIf { it.loadGeneration == generation }
            ?: activeTrackIdentity?.takeIf { it.loadGeneration == generation }
        if (identity == null || !currentPathMatches(identity.url)) {
            return
        }
        try {
            MPVLib.setPropertyBoolean("pause", false)
            val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
            if (!idle || loadingGeneration == generation) {
                emitState("playing")
            }
        } catch (e: Exception) {
            Log.w(TAG, "forceUnpause failed", e)
        }
    }

    private fun scheduleUnpauseRetries(generation: Long) {
        UNPAUSE_RETRY_DELAYS_MS.forEach { delayMs ->
            mainHandler.postDelayed({ forceUnpause(generation) }, delayMs)
        }
    }

    private fun readPlaylistCount(): Int =
        try {
            MPVLib.getPropertyInt("playlist-count")?.toInt() ?: 0
        } catch (_: Exception) {
            0
        }

    private fun readPlaylistPosition(): Int =
        try {
            MPVLib.getPropertyInt("playlist-pos")?.toInt() ?: -1
        } catch (_: Exception) {
            -1
        }

    private fun removePlaylistIndex(index: Int) {
        if (index < 0) {
            return
        }
        try {
            MPVLib.command(arrayOf("playlist-remove", index.toString()))
        } catch (e: Exception) {
            Log.d(TAG, "playlist item removal ignored", e)
        }
    }

    private fun compactPlaylistBeforeCurrent() {
        if (!pendingPlaylistCompaction) {
            return
        }

        var position = readPlaylistPosition()
        if (position <= 0) {
            if (readPlaylistCount() <= 2) {
                pendingPlaylistCompaction = false
            }
            return
        }

        while (position > 0) {
            removePlaylistIndex(0)
            if (preparedPlaylistIndex > 0) {
                preparedPlaylistIndex -= 1
            }
            position -= 1
        }
        pendingPlaylistCompaction = false
    }

    private fun schedulePlaylistCompaction() {
        PLAYLIST_COMPACT_DELAYS_MS.forEach { delayMs ->
            mainHandler.postDelayed({ compactPlaylistBeforeCurrent() }, delayMs)
        }
    }

    private fun clearPreparedTrack(removeFromPlaylist: Boolean) {
        preparedTrack = null
        if (removeFromPlaylist && hasPlaylistPreparedTrack) {
            removePlaylistIndex(preparedPlaylistIndex)
        }
        hasPlaylistPreparedTrack = false
        preparedPlaylistIndex = -1
        // 队列里的曲目从未追加进 mpv playlist，直接丢弃即可，不需要 removePlaylistIndex。
        pendingPreparedQueue.clear()
    }

    private fun promotePreparedTrack(requireCurrentPath: Boolean = false): PreparedTrack? {
        val prepared = preparedTrack ?: return null
        val playlistPosition = readPlaylistPosition()
        val pathMatches = currentPathMatches(prepared.url)
        if (
            !hasPlaylistPreparedTrack ||
            playlistPosition != preparedPlaylistIndex ||
            (requireCurrentPath && !pathMatches)
        ) {
            Log.w(
                TAG,
                "prepared promotion rejected: pos=$playlistPosition expected=$preparedPlaylistIndex " +
                    "pathMatches=$pathMatches mediaId=${prepared.mediaId} " +
                    "token=${prepared.prepareToken}",
            )
            return null
        }
        preparedTrack = null
        hasPlaylistPreparedTrack = false
        preparedPlaylistIndex = -1
        pendingPlaylistCompaction = true
        videoOutput.detach()
        renditionKind = "audio"
        ownedVideoIdentity = null
        ownedAudioReturnIdentity = null
        audioReturnPosition = null
        videoNetworkPolicy = null
        outgoingAudioPosition = null
        cachedTitle = prepared.title
        cachedArtist = prepared.artist
        cachedAlbum = prepared.album
        cachedArtwork = prepared.artwork
        durationSecs = validDuration(prepared.duration)
        positionSecs = 0.0
        cacheAheadSecs = 0.0
        currentLoadGeneration = prepared.loadGeneration
        val identity = TrackIdentity(
            url = prepared.url,
            mediaId = prepared.mediaId,
            loadGeneration = prepared.loadGeneration,
            prepareToken = prepared.prepareToken,
            queueRevision = prepared.queueRevision,
        )
        replaceActiveIdentity(identity)
        loadingTrackIdentity = null
        syncMetadata()
        emitProgress(force = true)
        emitActiveTrackChanged(identity, "prepared")
        Log.d(
            TAG,
            "prepared promotion accepted: mediaId=${prepared.mediaId} " +
                "generation=${prepared.loadGeneration} token=${prepared.prepareToken} " +
                "queueRevision=${prepared.queueRevision}",
        )
        chainNextQueuedPrepareEntry()
        schedulePlaylistCompaction()
        return prepared
    }

    /**
     * 一首预备曲目提升后，如果批量预备时还留了后续曲目在 pendingPreparedQueue，
     * 就原生接续把下一条追加进 mpv playlist——不依赖 JS 再次调用，后台/JS 冻结
     * 时也能继续往下顶 runway。任何一步失败都只清空自己这条链路，退回到「靠
     * JS 下次 prepareNext 补齐」的既有兜底路径，不影响已经提升成功的当前曲目。
     */
    private fun chainNextQueuedPrepareEntry() {
        if (pendingPreparedQueue.isEmpty()) {
            return
        }
        val entry = pendingPreparedQueue.removeAt(0)
        try {
            appendPreparedTrackToMpv(entry.prepared, entry.headerString, entry.userAgent)
            Log.d(
                TAG,
                "chained queued prepare: mediaId=${entry.prepared.mediaId} " +
                    "remainingQueue=${pendingPreparedQueue.size}",
            )
        } catch (e: Exception) {
            Log.w(TAG, "chained queued prepare failed", e)
            clearPreparedTrack(removeFromPlaylist = false)
        }
    }

    private fun completeNaturalEnd(
        pending: PendingNaturalEnd,
        promotedTrack: PreparedTrack?,
    ) {
        if (pendingNaturalEnd?.serial != pending.serial) return
        pendingNaturalEnd = null
        val autoAdvanced = promotedTrack != null
        completedVideoIdentity = pending.videoEndIdentity?.takeIf {
            !autoAdvanced && renditionKind == "mv" && it == activeTrackIdentity &&
                it.loadGeneration == currentLoadGeneration && loadingTrackIdentity == null
        }
        // END_FILE is authoritative here. During mpv's teardown, eof-reached
        // may already be unavailable while idle-active has not changed yet.
        // New loads/identities and PLAYBACK_RESTART revoke this exact owner.
        val now = System.currentTimeMillis()
        Log.d(
            TAG,
            "END_FILE completed: endedMediaId=${pending.endedIdentity?.mediaId} " +
                "promotedMediaId=${promotedTrack?.mediaId} autoAdvanced=$autoAdvanced",
        )
        if (!autoAdvanced && durationSecs > 0) {
            positionSecs = durationSecs
            emitProgress(force = true)
        }
        sendEvent(
            ON_MPV_ENDED,
            Arguments.createMap().apply {
                putString("reason", "end")
                putBoolean("autoAdvanced", autoAdvanced)
                pending.endedIdentity?.let { putString("endedMediaId", it.mediaId) }
                pending.endedIdentity?.let { putDouble("endedLoadGeneration", it.loadGeneration.toDouble()) }
                putString("endedRenditionKind", pending.endedKind)
                promotedTrack?.let {
                    putString("promotedMediaId", it.mediaId)
                    putDouble("prepareToken", it.prepareToken.toDouble())
                    putDouble("queueRevision", it.queueRevision.toDouble())
                    putDouble("loadGeneration", it.loadGeneration.toDouble())
                }
            },
        )
        if (autoAdvanced) {
            ignoreEndFileUntilMs = max(ignoreEndFileUntilMs, now + NATURAL_END_DEDUP_MS)
            pendingUnpause.arm(currentLoadGeneration)
            suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
            scheduleUnpauseRetries(currentLoadGeneration)
            emitState("buffering")
        } else {
            emitState("ended")
        }
    }

    private fun resolvePendingPreparedPromotion(trigger: String): Boolean {
        val pending = pendingNaturalEnd ?: return false
        val promoted = promotePreparedTrack(requireCurrentPath = true) ?: return false
        Log.d(
            TAG,
            "prepared promotion resolved by $trigger: mediaId=${promoted.mediaId} " +
                "token=${promoted.prepareToken}",
        )
        completeNaturalEnd(pending, promoted)
        return true
    }

    private fun schedulePendingPreparedPromotion(pending: PendingNaturalEnd) {
        PREPARED_PROMOTION_RETRY_DELAYS_MS.forEachIndexed { index, delayMs ->
            mainHandler.postDelayed({
                if (pendingNaturalEnd?.serial != pending.serial) {
                    return@postDelayed
                }
                if (resolvePendingPreparedPromotion("retry-$index")) {
                    return@postDelayed
                }
                if (index == PREPARED_PROMOTION_RETRY_DELAYS_MS.lastIndex) {
                    val stalePrepared = preparedTrack
                    Log.e(
                        TAG,
                        "prepared promotion timed out: mediaId=${stalePrepared?.mediaId} " +
                            "pos=${readPlaylistPosition()} expected=$preparedPlaylistIndex",
                    )
                    // mpv may still advance its appended playlist after END_FILE. Stop
                    // before handing control back to JS so unconfirmed audio can never
                    // continue underneath the previous UI identity.
                    ignoreEndFileUntilMs =
                        System.currentTimeMillis() + END_FILE_SUPPRESS_MS
                    clearPreparedTrack(removeFromPlaylist = true)
                    MPVLib.command(arrayOf("stop"))
                    completeNaturalEnd(pending, null)
                }
            }, delayMs)
        }
    }

    private fun mediaSourceType(url: String): String {
        val scheme = try {
            Uri.parse(url).scheme?.lowercase()
        } catch (_: Exception) {
            null
        }
        return when (scheme) {
            "https" -> "https"
            "http" -> "http"
            "content" -> "content"
            "file" -> "file"
            null -> "path"
            else -> "other"
        }
    }

    private fun setLoadingIdentity(identity: TrackIdentity) {
        completedVideoIdentity = null
        loadingTrackIdentity = identity
    }

    private fun clearLoadingIdentity() {
        loadingTrackIdentity = null
    }

    private fun replaceActiveIdentity(identity: TrackIdentity) {
        completedVideoIdentity = null
        activeTrackIdentity = identity
    }

    private fun clearActiveIdentity() {
        readyGeneration = -1L
        failedAudioReturnGeneration = -1L
        ownedVideoIdentity = null
        ownedAudioReturnIdentity = null
        audioReturnPosition = null
        videoNetworkPolicy = null
        outgoingAudioPosition = null
        completedVideoIdentity = null
        activeTrackIdentity = null
    }

    private fun releaseMpvResources() {
        renditionTrackingEnabled = false
        videoOutput.clear()
        renditionKind = "audio"
        isInitialized.set(false)
        detachServiceReadyCallback()
        stopRequested = true
        pendingPlaylistCompaction = false
        pendingNaturalEnd = null
        clearPreparedTrack(removeFromPlaylist = false)
        hasPlaylistPreparedTrack = false
        preparedPlaylistIndex = -1
        clearActiveIdentity()
        clearLoadingIdentity()
        loadingGeneration = -1L
        pendingUnpause.cancel()
        MpvServiceBridge.onCommand = null
        MpvServiceBridge.onBrowseRequest = null
        MpvServiceBridge.pauseNow = null
        unregisterAndroidAutoConnectionDetector(notifyJs = false)
        networkCallback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        networkCallback = null
        try {
            reactContext.stopService(
                Intent(reactContext, MpvPlaybackService::class.java),
            )
        } catch (_: Exception) {
        }
        try {
            MPVLib.removeObserver(this@MpvPlayerModule)
        } catch (_: Throwable) {
        }
        if (mpvInstance != null) {
            try {
                MPVLib.command(arrayOf("stop"))
            } catch (_: Throwable) {
            }
        }
        try {
            MPVLib.destroy()
        } catch (error: Throwable) {
            Log.e(TAG, "release failed", error)
        }
        currentState = "idle"
        positionSecs = 0.0
        durationSecs = 0.0
        cacheAheadSecs = 0.0
        MpvServiceBridge.clearPlaybackSession()
    }

    @ReactMethod
    fun initialize(options: ReadableMap, promise: Promise) {
        if (isInitialized.get()) {
            promise.resolve(null)
            return
        }

        postPromise(promise, "E_MPV_INIT") { operationPromise ->
            if (isInitialized.get()) {
                operationPromise.resolve(null)
                return@postPromise
            }
            try {
                MpvServiceBridge.clearPlaybackSession()
                MPVLib.create(reactContext.applicationContext)
                MPVLib.setOptionString("ao", "audiotrack,opensles")
                MPVLib.setOptionString("vo", "null")
                MPVLib.setOptionString("vid", "no")
                MPVLib.setOptionString("gpu-context", "android")
                MPVLib.setOptionString("cache", "yes")
                MPVLib.setOptionString("cache-secs", "2")
                // demuxer-max-bytes 是「内存里」的解复用缓存上限，绝不能接
                // basic.maxCacheSize——那是音乐【磁盘】缓存上限（默认 512MB，
                // 用户最大可设到 8GB）。而且 demuxer-readahead-secs 是「至少
                // 预读这么多」，开了 cache=yes 之后网络流会一直预读到字节上限
                // 为止，于是 mpv 常驻占掉几百 MB 原生堆，切歌瞬间两个 demuxer
                // 叠加会把进程推到 1GB 以上，播几首就被系统杀掉。
                // 纯音频按压缩码率算，32MB 已经相当于 320kbps 十几分钟的缓冲。
                MPVLib.setOptionString(
                    "demuxer-max-bytes",
                    MAX_DEMUXER_BYTES.toString(),
                )
                MPVLib.setOptionString(
                    "demuxer-max-back-bytes",
                    MAX_DEMUXER_BACK_BYTES.toString(),
                )
                MPVLib.setOptionString("demuxer-readahead-secs", "2")
                MPVLib.setOptionString("network-timeout", "15")
                MPVLib.setOptionString("msg-level", "all=warn")
                MPVLib.setOptionString("hwdec", "no")
                // Let mpv naturally advance appended prepared-next entries. JS
                // handles the final ended state when there is no prepared next.
                MPVLib.setOptionString("keep-open", "no")
                MPVLib.setOptionString("gapless-audio", "yes")
                // 音量平衡：按文件里的 ReplayGain 标签调音量，没有标签的歌不变（见 ReplayGain）
                MPVLib.setOptionString(
                    "replaygain",
                    ReplayGain.mpvValue(readString(options, "replayGain")),
                )

                defaultUserAgent = readString(options, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                defaultUserAgent?.let { MPVLib.setOptionString("user-agent", it) }
                MpvServiceBridge.remoteDuckMode = readDuckMode(options)
                MpvServiceBridge.remoteDuckVolume = readDuckVolume(options)
                MpvServiceBridge.showStopAction =
                    readBoolean(options, "showStopAction") ?: false
                progressIntervalMs = readProgressIntervalMs(options)
                registerAndroidAutoConnectionDetector()

                if (options.hasKey("mpvOptions") && !options.isNull("mpvOptions")) {
                    options.getMap("mpvOptions")?.let { opts ->
                        val iterator = opts.keySetIterator()
                        while (iterator.hasNextKey()) {
                            val key = iterator.nextKey()
                            val value = readString(opts, key)
                            if (key.isNotBlank() && value != null) {
                                MPVLib.setOptionString(key, value)
                            }
                        }
                    }
                }

                MPVLib.init()
                MPVLib.addObserver(this@MpvPlayerModule)

                MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("time-pos", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("duration", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("idle-active", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("playback-error", MPVLib.MPV_FORMAT_STRING)
                MPVLib.observeProperty(
                    "demuxer-cache-duration",
                    MPVLib.MPV_FORMAT_DOUBLE,
                )

                startPlaybackService(foreground = false)

                // 新的播放会话：上一次的外部暂停、打断不再作数
                MpvServiceBridge.playbackHold.claim()
                MpvServiceBridge.pauseNow = {
                    runMpvCallbackOnMain { keepHeldPaused("external") }
                }
                MpvServiceBridge.onBrowseRequest = { parentId, requestId ->
                    if (!invalidated.get()) {
                        sendEvent(
                            ON_MPV_BROWSE_REQUEST,
                            Arguments.createMap().apply {
                                putString("parentId", parentId)
                                putString("requestId", requestId)
                            },
                        )
                    }
                }
                MpvServiceBridge.onCommand = { command, position, mediaId ->
                    if (!invalidated.get()) {
                        sendEvent(
                            ON_MPV_REMOTE_COMMAND,
                            Arguments.createMap().apply {
                                putString("command", command)
                                // JS 线程被冻结时事件会在桥上堆积，回到前台后一次性
                                // 重放会连跳好几首。带上入队时间，让 JS 丢弃过期命令。
                                putDouble(
                                    "enqueuedAt",
                                    System.currentTimeMillis().toDouble(),
                                )
                                if (mediaId != null) {
                                    putString("mediaId", mediaId)
                                }
                                if (position != null) {
                                    if (command == "duck") {
                                        putDouble("volume", position)
                                    } else {
                                        putDouble("position", position)
                                    }
                                }
                            },
                        )
                    }
                }

                isInitialized.set(true)
                MpvServiceBridge.onServiceReady = serviceReadyCallback
                // Also cover service creation before initialization finished.
                MpvServiceBridge.service?.let(serviceReadyCallback)
                operationPromise.resolve(null)
            } catch (e: Throwable) {
                Log.e(TAG, "init failed", e)
                releaseMpvResources()
                operationPromise.reject("E_MPV_INIT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        isInitialized.set(false)
        postPromise(promise, "E_MPV_DESTROY") { operationPromise ->
            try {
                releaseMpvResources()
            } catch (e: Throwable) {
                Log.e(TAG, "destroy failed", e)
            } finally {
                operationPromise.resolve(null)
            }
        }
    }

    override fun invalidate() {
        if (!invalidated.compareAndSet(false, true)) {
            return
        }
        isInitialized.set(false)
        MpvServiceBridge.onCommand = null
        MpvServiceBridge.onBrowseRequest = null
        MpvServiceBridge.pauseNow = null
        androidAutoConnectionDetector?.onConnectionChanged = null
        pendingMainTasks.toList().forEach { it.cancel() }
        activePromises.toList().forEach { it.cancel() }
        mainHandler.removeCallbacksAndMessages(null)

        val cleanup = Runnable {
            releaseMpvResources()
            mainHandler.removeCallbacksAndMessages(null)
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            cleanup.run()
        } else if (!mainHandler.postAtFrontOfQueue(cleanup)) {
            cleanup.run()
        }
        super.invalidate()
    }

    @ReactMethod
    fun isAndroidAutoConnected(promise: Promise) {
        promise.resolve(isAndroidAutoConnected)
    }

    @ReactMethod
    fun updateQueueSnapshot(payload: ReadableMap, promise: Promise) {
        try {
            val currentIndex =
                if (payload.hasKey("currentIndex") && !payload.isNull("currentIndex")) {
                    payload.getInt("currentIndex")
                } else {
                    -1
                }
            val tracks =
                if (payload.hasKey("tracks") && !payload.isNull("tracks")) {
                    readQueueSnapshot(payload.getArray("tracks"))
                } else {
                    emptyList()
                }

            MpvServiceBridge.updateQueueSnapshot(tracks, currentIndex)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_MPV_QUEUE_SNAPSHOT", error.message, error)
        }
    }

    /** Android Auto 要的“我喜欢”“最近播放”，JS 给回来的内容（见 MpvMediaBrowserService） */
    @ReactMethod
    fun provideBrowseChildren(parentId: String, requestId: String, items: ReadableArray?, promise: Promise) {
        try {
            MpvMediaBrowserService.getInstance()
                ?.deliverLibraryChildren(parentId, requestId, readQueueSnapshot(items))
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_MPV_BROWSE", error.message, error)
        }
    }

    private fun readQueueSnapshot(array: ReadableArray?): List<MpvQueueTrack> {
        if (array == null) return emptyList()

        val tracks = mutableListOf<MpvQueueTrack>()
        for (index in 0 until array.size()) {
            val item = array.getMap(index) ?: continue
            val id = readString(item, "id")?.takeIf { it.isNotBlank() } ?: continue
            tracks.add(
                MpvQueueTrack(
                    id = id,
                    title = readString(item, "title")?.takeIf { it.isNotBlank() } ?: "未知歌曲",
                    artist = readString(item, "artist").orEmpty(),
                    album = readString(item, "album").orEmpty(),
                    artwork = readString(item, "artwork")?.takeIf { it.isNotBlank() },
                ),
            )
        }
        return tracks
    }

    @ReactMethod
    fun loadAndPlay(payload: ReadableMap, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }

        val url = readString(payload, "url")
        if (url.isNullOrBlank()) {
            promise.reject("E_NO_URL", "no URL")
            return
        }

        postPromise(promise, "E_LOAD") { operationPromise ->
            val restoreOrRestart = readString(payload, "positionMode") in listOf("restore-audio", "start-zero")
            val outgoingIdentity = if (readString(payload, "positionMode") == "restore-audio" && ownedAudioReturnIdentity != null) {
                ownedAudioReturnIdentity
            } else if (restoreOrRestart && renditionKind == "mv") {
                ownedVideoIdentity ?: activeTrackIdentity
            } else activeTrackIdentity
            val outgoingKind = renditionKind
            val previousNetworkPolicy = videoNetworkPolicy
            val previousVideoOwner = ownedVideoIdentity
            val previousReturnOwner = ownedAudioReturnIdentity
            val previousReturnPosition = audioReturnPosition
            val previousAudioPosition = outgoingAudioPosition
            val previousTitle = cachedTitle
            val previousArtist = cachedArtist
            val previousAlbum = cachedAlbum
            val previousArtwork = cachedArtwork
            val previousDuration = durationSecs
            val previousPosition = positionSecs
            val previousState = currentState
            val previousRate = MPVLib.getPropertyDouble("speed")
            val previousReadyGeneration = readyGeneration
            var capturedForFailure: Double? = null
            val wasPaused = MPVLib.getPropertyBoolean("pause") != false
            val isRenditionRequest = payload.hasKey("positionMode") || payload.hasKey("renditionKind")
            var renditionMutationStarted = false
            try {
                val nextKind = readString(payload, "renditionKind") ?: "audio"
                require(nextKind == "audio" || nextKind == "mv") { "invalid rendition kind" }
                val nextNetworkPolicy = readString(payload, "videoNetworkPolicy")
                require(nextNetworkPolicy == null || nextNetworkPolicy in listOf("unmetered", "allow-metered")) { "invalid video network policy" }
                if (nextKind == "mv") {
                    require(readBoolean(payload, "requireForeground") != true || reactContext.lifecycleState == LifecycleState.RESUMED) { "MV requires foreground" }
                    require(videoNetworkAllowed(nextNetworkPolicy)) { "Video network unavailable" }
                }
                val mode = readString(payload, "positionMode")
                val playbackRate = readDouble(payload, "playbackRate")
                require(playbackRate == null || (playbackRate.isFinite() && playbackRate > 0.0)) { "invalid playback rate" }
                require(mode == null || readDouble(payload, "preservePositionFallback") == null) {
                    "rendition and audio fallback policies cannot be combined"
                }
                require(nextKind != "mv" || mode != null) { "MV requires an explicit position policy" }
                val explicitStart = readDouble(payload, "startPosition")
                val retryAudioReturn = mode == "restore-audio" && outgoingKind == "audio" &&
                    outgoingIdentity != null && outgoingIdentity == ownedAudioReturnIdentity &&
                    explicitStart != null && explicitStart == audioReturnPosition
                if (mode == "restore-audio") {
                    require(nextKind == "audio" && (outgoingKind == "mv" || retryAudioReturn) && explicitStart != null &&
                        explicitStart.isFinite() && explicitStart >= 0.0) { "invalid audio return position" }
                }
                val capturedPosition = mode?.let {
                    require(it in listOf("start-zero", "preserve-mv", "restore-audio")) { "invalid position policy" }
                    require(it != "start-zero" || nextKind == "mv") { "start-zero is a video transition" }
                    val ownedVideoReplacement = outgoingKind == "mv" && outgoingIdentity == ownedVideoIdentity &&
                        it in listOf("restore-audio", "start-zero")
                    require((loadingTrackIdentity == null || ownedVideoReplacement || retryAudioReturn) && outgoingIdentity != null &&
                        outgoingIdentity.mediaId == readString(payload, "expectedMediaId") &&
                        outgoingIdentity.loadGeneration == readLong(payload, "expectedLoadGeneration") &&
                        currentLoadGeneration == outgoingIdentity.loadGeneration) {
                        "stale rendition replacement"
                    }
                    require(it != "preserve-mv" || (outgoingKind == "mv" && nextKind == "mv")) { "invalid video replacement" }
                    val completedVideo = outgoingKind == "mv" && completedVideoIdentity == outgoingIdentity
                    val liveFile = currentPathMatches(outgoingIdentity.url) &&
                        MPVLib.getPropertyBoolean("idle-active") != true && MPVLib.getPropertyBoolean("eof-reached") != true
                    require(liveFile || ownedVideoReplacement || retryAudioReturn || (completedVideo && it != "preserve-mv")) { "stale rendition replacement" }
                    // Capture after pausing the actual outgoing file, beside loadfile. No JS fallback.
                    // A completed MV needs no outgoing clock for a new zero start or
                    // the already captured audio return. Audio entry/preserve remain live-only.
                    if ((completedVideo || ownedVideoReplacement || retryAudioReturn) && !liveFile) return@let null
                    renditionMutationStarted = true
                    MPVLib.setPropertyBoolean("pause", true)
                    if (it == "restore-audio") return@let null
                    MPVLib.getPropertyDouble("time-pos")?.takeIf { pos -> pos.isFinite() && pos >= 0.0 }
                        ?: throw IllegalStateException("outgoing engine position unavailable")
                }
                val previousIdentity = loadingTrackIdentity ?: activeTrackIdentity
                if (outgoingKind == "audio" && nextKind == "mv") capturedForFailure = capturedPosition
                val previousDeferredPosition = if (loadingGeneration == currentLoadGeneration) {
                    pendingSeek.peek(currentLoadGeneration)
                } else null
                val preserveFallback = readDouble(payload, "preservePositionFallback")
                    ?.takeIf { it.isFinite() && it >= 0.0 }
                val headers =
                    if (payload.hasKey("headers") && !payload.isNull("headers")) {
                        payload.getMap("headers")
                    } else {
                        null
                    }
                val trackUserAgent = readString(payload, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                renditionMutationStarted = true
                MPVLib.setOptionString(
                    "http-header-fields",
                    buildHeaderString(headers),
                )
                (trackUserAgent ?: defaultUserAgent)
                    ?.let { MPVLib.setOptionString("user-agent", it) }

                durationSecs = validDuration(readDouble(payload, "duration"))
                // 外部暂停、系统打断着：按暂停装载，等用户明确要播或系统还回焦点
                val requestedAutoPlay = readBoolean(payload, "autoPlay") ?: true
                val autoPlay =
                    requestedAutoPlay && !MpvServiceBridge.playbackHold.blocksAutoPlay && (nextKind != "mv" || videoNetworkAllowed(nextNetworkPolicy))
                if (requestedAutoPlay && !autoPlay) {
                    Log.d(TAG, "loadAndPlay held: ${MpvServiceBridge.playbackHold}")
                }
                positionSecs = 0.0
                cacheAheadSecs = 0.0
                cachedTitle = readString(payload, "title") ?: ""
                cachedArtist = readString(payload, "artist") ?: ""
                cachedAlbum = readString(payload, "album") ?: ""
                cachedArtwork = readString(payload, "artwork")
                pendingPlaylistCompaction = false
                pendingNaturalEnd = null
                clearPreparedTrack(removeFromPlaylist = false)

                val mediaId = readString(payload, "mediaId")?.takeIf { it.isNotBlank() }
                    ?: throw IllegalArgumentException("missing mediaId")
                val requestedGeneration = readLong(payload, "loadGeneration")
                    ?: throw IllegalArgumentException("missing loadGeneration")
                setLoadingIdentity(TrackIdentity(
                    url = url,
                    mediaId = mediaId,
                    loadGeneration = requestedGeneration,
                    prepareToken = readLong(payload, "prepareToken") ?: 0L,
                    queueRevision = readLong(payload, "queueRevision") ?: 0L,
                ))

                if (nextKind == "mv") renditionTrackingEnabled = true
                val generation = markLoading(autoPlay, requestedGeneration)
                videoOutput.detach()
                renditionKind = nextKind
                videoNetworkPolicy = if (nextKind == "mv") nextNetworkPolicy else null
                if (videoNetworkPolicy != null) watchVideoNetwork()
                ownedVideoIdentity = if (nextKind == "mv") loadingTrackIdentity else null
                ownedAudioReturnIdentity = if (mode == "restore-audio") loadingTrackIdentity else null
                audioReturnPosition = if (mode == "restore-audio") explicitStart else null
                outgoingAudioPosition = when {
                    nextKind == "mv" && outgoingKind == "audio" -> capturedPosition
                    nextKind == "mv" -> previousAudioPosition
                    else -> null
                }
                val renditionStart = when (mode) {
                    "restore-audio" -> explicitStart
                    "preserve-mv" -> capturedPosition
                    "start-zero" -> 0.0
                    else -> null
                }
                renditionStart?.let { pendingSeek.defer(generation, it); positionSecs = it }
                if (nextKind == "mv") MPVLib.setPropertyDouble("speed", 1.0)
                else playbackRate?.let { MPVLib.setPropertyDouble("speed", it) }
                if (autoPlay) {
                    startPlaybackService(foreground = true)
                }
                if (!autoPlay) {
                    MPVLib.setPropertyBoolean("pause", true)
                }
                emitState(if (autoPlay) "buffering" else "paused")
                syncMetadata()
                emitProgress(force = true)

                Log.d(
                    TAG,
                    "loadAndPlay[$generation]: source=${mediaSourceType(url)}",
                )
                // Run beside loadfile, after metadata work. The old engine may have
                // advanced while the JS bridge/main looper was waiting.
                val restoredPosition = preserveFallback?.let { fallback ->
                    SourceReplacementPosition.capture(
                        fallback = fallback,
                        sameMedia = previousIdentity != null && previousIdentity.mediaId == mediaId &&
                            (previousDeferredPosition != null || currentPathMatches(previousIdentity.url)),
                        pause = { MPVLib.setPropertyBoolean("pause", true) },
                        position = {
                            // Natural advancement must not assign a different file's position.
                            previousIdentity?.takeIf { currentPathMatches(it.url) }
                                ?.let { MPVLib.getPropertyDouble("time-pos") }
                        },
                        pendingPosition = previousDeferredPosition,
                    ).also { stopped ->
                        MPVLib.setPropertyBoolean("pause", true)
                        pendingSeek.defer(generation, stopped)
                        positionSecs = stopped
                        emitProgress(force = true)
                        Log.d(TAG, "source replacement[$generation]: stopped=$stopped fallback=$fallback")
                    }
                }
                engineProgressMarker.onLoad(generation)
                PerfMarks.mark("engine-load", "gen=$generation source=${mediaSourceType(url)}")
                MPVLib.command(arrayOf("loadfile", url, "replace"))
                if (autoPlay) {
                    scheduleUnpauseRetries(generation)
                } else {
                    MPVLib.setPropertyBoolean("pause", true)
                    emitState("paused", force = true)
                }
                operationPromise.resolve(if (mode == "start-zero") capturedPosition else renditionStart ?: restoredPosition)
            } catch (e: Exception) {
                var rolledBack = false
                // A rejected stale/invalid request has no ownership over another load's
                // identity, seek or pending unpause. Roll back only work this call began.
                if (!isRenditionRequest || renditionMutationStarted) {
                    clearLoadingIdentity()
                    if (readString(payload, "positionMode") != null && outgoingIdentity != null && currentPathMatches(outgoingIdentity.url)) {
                        currentLoadGeneration = outgoingIdentity.loadGeneration
                        loadingGeneration = -1L
                        pendingUnpause.cancel()
                        pendingSeek.reset()
                        renditionKind = outgoingKind
                        videoNetworkPolicy = previousNetworkPolicy
                        ownedVideoIdentity = previousVideoOwner
                        ownedAudioReturnIdentity = previousReturnOwner
                        audioReturnPosition = previousReturnPosition
                        outgoingAudioPosition = previousAudioPosition
                        cachedTitle = previousTitle
                        cachedArtist = previousArtist
                        cachedAlbum = previousAlbum
                        cachedArtwork = previousArtwork
                        durationSecs = previousDuration
                        positionSecs = MPVLib.getPropertyDouble("time-pos")?.takeIf { it.isFinite() && it >= 0.0 } ?: previousPosition
                        readyGeneration = previousReadyGeneration
                        previousRate?.let { MPVLib.setPropertyDouble("speed", it) }
                        if (!wasPaused && !MpvServiceBridge.playbackHold.blocksAutoPlay) {
                            MPVLib.setPropertyBoolean("pause", false)
                        }
                        videoOutput.refresh()
                        syncMetadata()
                        emitState(if (wasPaused) "paused" else previousState, force = true)
                        rolledBack = true
                    }
                }
                Log.e(TAG, "loadAndPlay failed", e)
                operationPromise.reject(
                    if (rolledBack) "E_RENDITION_ROLLED_BACK" else if (isRenditionRequest && !renditionMutationStarted) "E_RENDITION_REJECTED" else "E_LOAD",
                    e.message, e,
                    Arguments.createMap().apply {
                        outgoingIdentity?.let {
                            putString("mediaId", it.mediaId)
                            putDouble("loadGeneration", it.loadGeneration.toDouble())
                        }
                        capturedForFailure?.let { putDouble("outgoingAudioPosition", it) }
                    },
                )
            }
        }
    }

    /** 从 payload 解析出一个 PreparedTrack；url 已经在调用方校验过非空。 */
    private fun parsePreparedTrack(map: ReadableMap, url: String): PreparedTrack =
        PreparedTrack(
            url = url,
            mediaId = readString(map, "mediaId")
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("missing mediaId"),
            loadGeneration = readLong(map, "loadGeneration")
                ?: throw IllegalArgumentException("missing loadGeneration"),
            prepareToken = readLong(map, "prepareToken")
                ?: throw IllegalArgumentException("missing prepareToken"),
            queueRevision = readLong(map, "queueRevision")
                ?: throw IllegalArgumentException("missing queueRevision"),
            title = readString(map, "title") ?: "",
            artist = readString(map, "artist") ?: "",
            album = readString(map, "album") ?: "",
            artwork = readString(map, "artwork"),
            duration = validDuration(readDouble(map, "duration")),
            sourceMediaId = readString(map, "sourceMediaId"),
            sourceLoadGeneration = readLong(map, "sourceLoadGeneration"),
        )

    private fun requirePrepareOwner(mediaId: String?, generation: Long?) {
        if (mediaId == null && generation == null) return // legacy audio callers
        require(loadingTrackIdentity == null && activeTrackIdentity?.let {
            it.mediaId == mediaId && it.loadGeneration == generation && generation == currentLoadGeneration
        } == true) { "stale prepared source" }
    }

    private fun requirePrepareBatchOwners(payloads: ReadableArray?) {
        if (payloads == null || payloads.size() == 0) return
        val first = payloads.getMap(0) ?: return
        requirePrepareOwner(readString(first, "sourceMediaId"), readLong(first, "sourceLoadGeneration"))
        var previousId = activeTrackIdentity?.mediaId
        var previousGeneration = activeTrackIdentity?.loadGeneration
        for (index in 0 until payloads.size()) {
            val entry = payloads.getMap(index) ?: continue
            val sourceId = readString(entry, "sourceMediaId")
            val sourceGeneration = readLong(entry, "sourceLoadGeneration")
            if (sourceId != null || sourceGeneration != null) {
                require(sourceId == previousId && sourceGeneration == previousGeneration &&
                    !readString(entry, "url").isNullOrBlank()) { "stale prepared chain" }
            }
            previousId = readString(entry, "mediaId")
            previousGeneration = readLong(entry, "loadGeneration")
        }
    }

    /**
     * prepareNext 与批量预备/原生自动接续共用的核心：把一首曲目追加进 mpv
     * playlist，并把它设为唯一的「已追加待提升」曲目。调用前 preparedTrack
     * 必须已经是空的——批量预备的后续曲目在这之前会先进 pendingPreparedQueue，
     * 不会并发调用到这里。
     */
    private fun appendPreparedTrackToMpv(
        prepared: PreparedTrack,
        headerString: String,
        userAgent: String?,
    ) {
        requirePrepareOwner(prepared.sourceMediaId, prepared.sourceLoadGeneration)
        MPVLib.setOptionString("http-header-fields", headerString)
        (userAgent ?: defaultUserAgent)?.let { MPVLib.setOptionString("user-agent", it) }

        val appendIndex = readPlaylistCount()
        MPVLib.command(arrayOf("loadfile", prepared.url, "append"))
        preparedTrack = prepared
        hasPlaylistPreparedTrack = true
        preparedPlaylistIndex = appendIndex
        Log.d(
            TAG,
            "prepareNext: mediaId=${prepared.mediaId} " +
                "generation=${prepared.loadGeneration} " +
                "token=${prepared.prepareToken} " +
                "queueRevision=${prepared.queueRevision} index=$appendIndex",
        )
    }

    @ReactMethod
    fun prepareNext(payload: ReadableMap?, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }

        postPromise(promise, "E_PREPARE_NEXT") { operationPromise ->
            var mutated = false
            try {
                payload?.let { requirePrepareOwner(readString(it, "sourceMediaId"), readLong(it, "sourceLoadGeneration")) }
                // 清空前先记下是否真的存在 runway：JS 提交空 url 时这里会把唯一的
                // 预载项摘掉，而这条路径以前完全不打日志，导致「后台播到曲尾就停」
                // 长期不可观测。
                val hadPrepared = hasPlaylistPreparedTrack
                val previousPreparedMediaId = preparedTrack?.mediaId
                mutated = true
                clearPreparedTrack(removeFromPlaylist = true)
                val nextPayload = payload
                val url = nextPayload?.let { readString(it, "url") }
                if (nextPayload == null || url.isNullOrBlank()) {
                    val skipReason = nextPayload
                        ?.let { readString(it, "skipReason") }
                        ?: "null-payload"
                    val skipMediaId = nextPayload?.let { readString(it, "mediaId") }
                    val skipIndex = nextPayload?.let { readDouble(it, "index") }
                    val skipActiveIndex =
                        nextPayload?.let { readDouble(it, "activeIndex") }
                    val skipQueueRevision =
                        nextPayload?.let { readDouble(it, "queueRevision") }
                    Log.w(
                        TAG,
                        "prepareNext skipped: reason=$skipReason " +
                            "mediaId=$skipMediaId index=${skipIndex?.toInt()} " +
                            "activeIndex=${skipActiveIndex?.toInt()} " +
                            "queueRevision=${skipQueueRevision?.toInt()} " +
                            "clearedRunway=$hadPrepared " +
                            "previousPreparedMediaId=$previousPreparedMediaId",
                    )
                    operationPromise.resolve(null)
                    return@postPromise
                }

                val headers =
                    if (nextPayload.hasKey("headers") && !nextPayload.isNull("headers")) {
                        nextPayload.getMap("headers")
                    } else {
                        null
                    }
                val trackUserAgent = readString(nextPayload, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                val prepared = parsePreparedTrack(nextPayload, url)
                appendPreparedTrackToMpv(prepared, buildHeaderString(headers), trackUserAgent)
                operationPromise.resolve(null)
            } catch (e: Exception) {
                Log.w(TAG, "prepareNext failed", e)
                if (mutated) clearPreparedTrack(removeFromPlaylist = false)
                operationPromise.reject("E_PREPARE_NEXT", e.message, e)
            }
        }
    }

    /**
     * 批量预备：第一首走与 prepareNext 完全相同的「立即追加」路径；第二首起
     * 存进 pendingPreparedQueue，由 promotePreparedTrack 在每次成功提升后原生
     * 接续追加。目的是把 runway 从「1 首」延长到「JS 一次性给出的深度」，
     * 让 mpv 在 JS 冻结的后台窗口内也能连续跨多首曲目，而不需要每首都等 JS
     * 醒来再调用一次 prepareNext。
     */
    @ReactMethod
    fun prepareNextBatch(payloads: ReadableArray?, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }

        postPromise(promise, "E_PREPARE_NEXT_BATCH") { operationPromise ->
            var mutated = false
            try {
                requirePrepareBatchOwners(payloads)
                val hadPrepared = hasPlaylistPreparedTrack
                val previousPreparedMediaId = preparedTrack?.mediaId
                mutated = true
                clearPreparedTrack(removeFromPlaylist = true)

                val count = payloads?.size() ?: 0
                if (count == 0) {
                    Log.w(
                        TAG,
                        "prepareNextBatch skipped: reason=empty-batch " +
                            "clearedRunway=$hadPrepared " +
                            "previousPreparedMediaId=$previousPreparedMediaId",
                    )
                    operationPromise.resolve(null)
                    return@postPromise
                }

                var appended = 0
                for (index in 0 until count) {
                    val entryMap = payloads?.getMap(index) ?: continue
                    val url = readString(entryMap, "url")
                    if (url.isNullOrBlank()) {
                        Log.w(
                            TAG,
                            "prepareNextBatch entry skipped: index=$index reason=blank-url",
                        )
                        continue
                    }
                    val prepared = try {
                        parsePreparedTrack(entryMap, url)
                    } catch (e: Exception) {
                        Log.w(
                            TAG,
                            "prepareNextBatch entry skipped: index=$index " +
                                "reason=${e.message}",
                        )
                        continue
                    }
                    val headers =
                        if (entryMap.hasKey("headers") && !entryMap.isNull("headers")) {
                            entryMap.getMap("headers")
                        } else {
                            null
                        }
                    val trackUserAgent = readString(entryMap, "userAgent")
                        ?.takeIf { it.isNotBlank() }
                    val headerString = buildHeaderString(headers)
                    if (appended == 0) {
                        appendPreparedTrackToMpv(prepared, headerString, trackUserAgent)
                    } else {
                        pendingPreparedQueue.add(
                            QueuedPrepareEntry(prepared, headerString, trackUserAgent),
                        )
                    }
                    appended += 1
                }

                if (appended == 0) {
                    Log.w(TAG, "prepareNextBatch skipped: reason=no-valid-entries")
                } else {
                    Log.d(
                        TAG,
                        "prepareNextBatch: appended=$appended " +
                            "queued=${pendingPreparedQueue.size}",
                    )
                }
                operationPromise.resolve(null)
            } catch (e: Exception) {
                Log.w(TAG, "prepareNextBatch failed", e)
                if (mutated) clearPreparedTrack(removeFromPlaylist = false)
                operationPromise.reject("E_PREPARE_NEXT_BATCH", e.message, e)
            }
        }
    }

    @ReactMethod
    fun updateMetadata(payload: ReadableMap, promise: Promise) {
        postPromise(promise, "E_MPV_METADATA") { operationPromise ->
            try {
                cachedTitle = readString(payload, "title") ?: cachedTitle
                cachedArtist = readString(payload, "artist") ?: cachedArtist
                cachedAlbum = readString(payload, "album") ?: cachedAlbum
                if (payload.hasKey("artwork")) {
                    cachedArtwork = readString(payload, "artwork")
                }
                // 「JS 压根没传封面」和「传了但没抓下来」在界面上都是默认图标，
                // 必须能分辨；只记有无与长度，不打 URL 本身。
                Log.d(
                    TAG,
                    "updateMetadata: title=${cachedTitle.take(24)} " +
                        "hasArtworkKey=${payload.hasKey("artwork")} " +
                        "artworkLen=${cachedArtwork?.length ?: -1}",
                )
                val duration = validDuration(readDouble(payload, "duration"))
                if (duration > 0) {
                    durationSecs = duration
                }
                syncMetadata()
                emitProgress(force = true)
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_MPV_METADATA", e.message, e)
            }
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_PAUSE") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                // 明确暂停：撤销还排着的自动取消暂停，免得几百毫秒后又被放出来
                pendingUnpause.cancel()
                MPVLib.setPropertyBoolean("pause", true)
                emitState("paused")
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_PAUSE", e.message, e)
            }
        }
    }

    @ReactMethod
    fun resume(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_RESUME") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                // JS 的自动播放（补偿、回滚、打断结束）在外部暂停、系统打断之后不能
                // 出声；用户明确要播时 JS 先调 claimPlayback 解除
                if (MpvServiceBridge.playbackHold.blocksAutoPlay || (renditionKind == "mv" && !videoNetworkAllowed())) {
                    keepHeldPaused("resume")
                    operationPromise.resolve(null)
                    return@postPromise
                }
                startPlaybackService(foreground = true)
                val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                if (idle || currentState == "ended") {
                    MPVLib.command(arrayOf("seek", "0", "absolute"))
                }
                val generation = currentLoadGeneration
                pendingUnpause.arm(generation)
                scheduleUnpauseRetries(generation)
                emitState("playing")
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_RESUME", e.message, e)
            }
        }
    }

    /** 用户明确要播：解除外部暂停、系统打断对自动出声的拦截（见 [PlaybackHold]）。 */
    @ReactMethod
    fun resumeVideo(payload: ReadableMap, promise: Promise) {
        postPromise(promise, "E_VIDEO_RESUME") { result ->
            val owner = loadingTrackIdentity ?: activeTrackIdentity
            val policy = readString(payload, "policy")
            require(isInitialized.get() && renditionKind == "mv" && owner != null &&
                owner.mediaId == readString(payload, "mediaId") &&
                owner.loadGeneration == readLong(payload, "loadGeneration") &&
                owner.loadGeneration == currentLoadGeneration) { "Video superseded" }
            require(policy in listOf("unmetered", "allow-metered") && videoNetworkAllowed(policy)) { "Video network unavailable" }
            videoNetworkPolicy = policy
            watchVideoNetwork()
            if (MpvServiceBridge.playbackHold.blocksAutoPlay) keepHeldPaused("video-resume")
            else {
                startPlaybackService(foreground = true)
                pendingUnpause.arm(currentLoadGeneration)
                scheduleUnpauseRetries(currentLoadGeneration)
            }
            result.resolve(null)
        }
    }

    /** Explicit claim does not override the separate video network policy. */
    @ReactMethod
    fun claimPlayback(promise: Promise) {
        postPromise(promise, "E_CLAIM") { operationPromise ->
            MpvServiceBridge.playbackHold.claim()
            operationPromise.resolve(null)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_STOP") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                stopRequested = true
                videoOutput.detach()
                renditionKind = "audio"
                pendingPlaylistCompaction = false
                pendingNaturalEnd = null
                clearPreparedTrack(removeFromPlaylist = true)
                clearActiveIdentity()
                clearLoadingIdentity()
                loadingGeneration = -1L
                pendingUnpause.cancel()
                ignoreEndFileUntilMs = System.currentTimeMillis() + END_FILE_SUPPRESS_MS
                MPVLib.command(arrayOf("stop"))
                positionSecs = 0.0
                cacheAheadSecs = 0.0
                emitProgress(force = true)
                emitState("idle")
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_STOP", e.message, e)
            }
        }
    }

    @ReactMethod
    fun seekTo(seconds: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_SEEK") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                val generation = currentLoadGeneration
                if (loadingGeneration == generation) {
                    // 新文件还没加载好，现在跳会丢：等它加载好再跳（见 PendingSeek）
                    pendingSeek.defer(generation, seconds)
                } else {
                    MPVLib.command(arrayOf("seek", seconds.toString(), "absolute"))
                }
                positionSecs = seconds.coerceAtLeast(0.0)
                emitProgress(force = true)
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_SEEK", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setVolume(volume: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_VOLUME") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                MPVLib.setPropertyInt("volume", (volume * 100).toInt().coerceIn(0, 100))
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_VOLUME", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setRate(rate: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_RATE") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                MPVLib.setPropertyDouble("speed", rate)
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_RATE", e.message, e)
            }
        }
    }

    /** 音量平衡：mpv 的 replaygain 改了立刻按新模式重算增益，不用重新加载 */
    @ReactMethod
    fun setReplayGain(mode: String, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_REPLAY_GAIN") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                MPVLib.setPropertyString("replaygain", ReplayGain.mpvValue(mode))
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_REPLAY_GAIN", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getIsPlaying(promise: Promise) {
        postPromise(promise, "E_MPV_QUERY") { operationPromise ->
            try {
                val paused = MPVLib.getPropertyBoolean("pause") ?: true
                val idle = MPVLib.getPropertyBoolean("idle-active") ?: true
                operationPromise.resolve(!paused && !idle)
            } catch (_: Exception) {
                operationPromise.resolve(currentState == "playing")
            }
        }
    }

    @ReactMethod
    fun getPosition(promise: Promise) {
        postPromise(promise, "E_MPV_QUERY") { operationPromise ->
            try {
                operationPromise.resolve(
                    MPVLib.getPropertyDouble("time-pos") ?: positionSecs,
                )
            } catch (_: Exception) {
                operationPromise.resolve(positionSecs)
            }
        }
    }

    @ReactMethod
    fun getDuration(promise: Promise) {
        postPromise(promise, "E_MPV_QUERY") { operationPromise ->
            try {
                val nativeDuration = validDuration(MPVLib.getPropertyDouble("duration"))
                operationPromise.resolve(
                    if (nativeDuration > 0) nativeDuration else durationSecs,
                )
            } catch (_: Exception) {
                operationPromise.resolve(durationSecs)
            }
        }
    }

    /** One read on the existing owner thread; no observers, playback commands or URL export. */
    @ReactMethod
    fun getVideoInfo(promise: Promise) {
        postPromise(promise, "E_MPV_VIDEO_QUERY") { result ->
            val identity = loadingTrackIdentity ?: ownedVideoIdentity ?: activeTrackIdentity
            result.resolve(Arguments.createMap().apply {
                putString("mediaId", identity?.mediaId)
                putDouble("loadGeneration", currentLoadGeneration.toDouble())
                putString("kind", renditionKind)
                putBoolean("completed", identity != null && completedVideoIdentity == identity)
                outgoingAudioPosition?.let { putDouble("outgoingAudioPosition", it) }
                putInt("instance", mpvInstance?.let { System.identityHashCode(it) } ?: 0)
                putBoolean("surfaceAttached", videoOutput.isAttached)
                videoOutput.owner?.let { putDouble("surfaceOwner", it.toDouble()) }
                putString("codec", MPVLib.getPropertyString("video-codec"))
                putString("vo", MPVLib.getPropertyString("current-vo"))
                putString("hwdec", MPVLib.getPropertyString("hwdec-current"))
                MPVLib.getPropertyInt("width")?.let { putInt("width", it) }
                MPVLib.getPropertyInt("height")?.let { putInt("height", it) }
            })
        }
    }

    /** Paired clock/identity on the same owner thread, not two racing JS reads. */
    @ReactMethod
    fun getRenditionProgress(promise: Promise) {
        postPromise(promise, "E_MPV_QUERY") { result ->
            val identity = activeTrackIdentity
            if (identity == null || loadingTrackIdentity != null || identity.loadGeneration != currentLoadGeneration) {
                result.resolve(null)
                return@postPromise
            }
            result.resolve(Arguments.createMap().apply {
                putEventIdentity(this)
                val raw = MPVLib.getPropertyDouble("time-pos")
                putBoolean("ready", readyGeneration == currentLoadGeneration && raw != null && raw.isFinite() && raw >= 0.0)
                putDouble("position", raw?.takeIf { it.isFinite() && it >= 0.0 } ?: positionSecs)
                putDouble("duration", validDuration(MPVLib.getPropertyDouble("duration")).takeIf { it > 0.0 } ?: durationSecs)
                putDouble("buffered", bufferedPositionSecs())
            })
        }
    }

    @ReactMethod
    fun getAudioInfo(promise: Promise) {
        postPromise(promise, "E_MPV_QUERY") { operationPromise ->
            try {
                val identity = activeTrackIdentity
                if (!isInitialized.get() || identity == null || stopRequested ||
                    identity.loadGeneration != currentLoadGeneration ||
                    loadingGeneration == currentLoadGeneration || loadingTrackIdentity != null ||
                    MPVLib.getPropertyBoolean("idle-active") == true || !currentPathMatches(identity.url)) {
                    operationPromise.resolve(null)
                    return@postPromise
                }
                val info = DecodedAudioInfo.read(MPVLib::getPropertyString, MPVLib::getPropertyDouble)
                if (activeTrackIdentity != identity || !currentPathMatches(identity.url)) {
                    operationPromise.resolve(null)
                    return@postPromise
                }
                operationPromise.resolve(Arguments.createMap().apply {
                    putString("mediaId", identity.mediaId)
                    putDouble("loadGeneration", identity.loadGeneration.toDouble())
                    putString("codec", info.codec)
                    info.sampleRate?.let { putInt("sampleRate", it) } ?: putNull("sampleRate")
                    info.channelCount?.let { putInt("channelCount", it) } ?: putNull("channelCount")
                    info.bitrate?.let { putDouble("bitrate", it) } ?: putNull("bitrate")
                })
            } catch (_: Exception) {
                operationPromise.resolve(null)
            }
        }
    }

    private fun buildHeaderString(headers: ReadableMap?): String {
        if (headers == null) {
            return ""
        }
        val builder = StringBuilder()
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            val value = readString(headers, key)
            if (key.isNotBlank() && value != null) {
                builder.append(key).append(": ").append(value).append("\r\n")
            }
        }
        return builder.toString()
    }

    override fun eventProperty(property: String) {
    }

    /** 性能基线：这次装载后 time-pos 第一次自然往前走（见 EngineProgressMarker） */
    private fun markEngineProgress(position: Double) {
        val paused = currentState == "paused"
        if (engineProgressMarker.onPosition(currentLoadGeneration, position, paused)) {
            PerfMarks.mark("engine-progress", "gen=$currentLoadGeneration pos=$position")
        }
    }

    override fun eventProperty(property: String, value: Long) {
        readCurrentNumericProperty(property, value.toDouble())
    }

    override fun eventProperty(property: String, value: Boolean) {
        runOwnedPropertyOnMain {
            val currentValue = if (renditionTrackingEnabled) {
                MPVLib.getPropertyBoolean(property) ?: return@runOwnedPropertyOnMain
            } else value
            when (property) {
                "pause" -> {
                    val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                    if (currentValue) {
                        if (!idle && currentState != "ended") {
                            // Same-track replacement stops the old file to capture its
                            // position. That stop is buffering, not a user pause.
                            val restoringWhileLoading =
                                loadingGeneration == currentLoadGeneration &&
                                    pendingSeek.isPendingFor(currentLoadGeneration) &&
                                    pendingUnpause.isArmedFor(currentLoadGeneration) &&
                                    !MpvServiceBridge.playbackHold.blocksAutoPlay && (renditionKind != "mv" || videoNetworkAllowed())
                            emitState(if (restoringWhileLoading) "buffering" else "paused")
                        }
                    } else if (!idle || loadingGeneration == currentLoadGeneration) {
                        emitState("playing")
                    }
                }
                "idle-active" -> {
                    if (currentValue) {
                        val now = System.currentTimeMillis()
                        if (
                            now < suppressIdleUntilMs ||
                            loadingGeneration == currentLoadGeneration ||
                            currentState == "ended"
                        ) {
                            return@runOwnedPropertyOnMain
                        }
                        emitState("idle")
                    } else if (currentState != "paused" && currentState != "ended") {
                        emitState("playing")
                    }
                }
                "paused-for-cache" -> {
                    if (currentValue) {
                        emitState("buffering")
                    } else {
                        val paused = MPVLib.getPropertyBoolean("pause") ?: false
                        val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                        if (!paused && !idle) {
                            emitState("playing")
                        }
                    }
                }
            }
        }
    }

    override fun eventProperty(property: String, value: Double) {
        readCurrentNumericProperty(property, value)
    }

    private fun readCurrentNumericProperty(property: String, observed: Double) {
        runOwnedPropertyOnMain {
            if (renditionTrackingEnabled) {
                val identity = loadingTrackIdentity ?: activeTrackIdentity ?: return@runOwnedPropertyOnMain
                if (!currentPathMatches(identity.url)) return@runOwnedPropertyOnMain
            }
            val value = (if (renditionTrackingEnabled) MPVLib.getPropertyDouble(property) else observed)
                ?.takeIf { it.isFinite() && it >= 0.0 }
                ?: return@runOwnedPropertyOnMain
            when (property) {
                "time-pos" -> {
                    if (!value.isNaN() && value >= 0) {
                        positionSecs = value
                        markEngineProgress(value)
                        emitProgress()
                    }
                }
                "duration" -> {
                    if (!value.isNaN() && value > 0) {
                        durationSecs = value
                        syncMetadata()
                        emitProgress(force = true)
                    }
                }
                "demuxer-cache-duration" -> {
                    if (!value.isNaN() && value >= 0) {
                        cacheAheadSecs = value
                        emitProgress()
                    }
                }
            }
        }
    }

    override fun eventProperty(property: String, value: String) {
        runOwnedPropertyOnMain {
            if (property == "playback-error") {
                val currentError = (if (renditionTrackingEnabled) MPVLib.getPropertyString(property) else value)
                    ?.takeIf { it.isNotBlank() }
                    ?: return@runOwnedPropertyOnMain
                Log.e(TAG, "playback error")
                sendEvent(
                    ON_MPV_ERROR,
                    Arguments.createMap().apply {
                        putString("message", currentError)
                        putString("code", "mpv-playback-error")
                    },
                )
                emitState("error")
            }
        }
    }

    override fun event(eventId: Int) {
        // Latch the identity at callback receipt, before a queued new load can
        // replace it on the main looper. Only MV terminal ownership uses this;
        // ordinary prepared/audio end handling below retains its existing path.
        val videoEndIdentity = if (eventId == MPVLib.MPV_EVENT_END_FILE) activeTrackIdentity else null
        val callbackKind = renditionKind
        runMpvCallbackOnMain {
            when (eventId) {
                MPVLib.MPV_EVENT_START_FILE -> {
                    val explicitLoading = loadingTrackIdentity
                        ?.takeIf { currentPathMatches(it.url) }
                    val preparedLoading = preparedTrack
                        ?.takeIf { currentPathMatches(it.url) }
                    if (
                        explicitLoading == null &&
                        preparedLoading != null &&
                        resolvePendingPreparedPromotion("START_FILE")
                    ) {
                        loadingGeneration = -1L
                        return@runMpvCallbackOnMain
                    }
                    val generation = currentLoadGeneration
                    loadingGeneration = if (explicitLoading != null) generation else -1L
                    if (
                        explicitLoading != null &&
                        pendingUnpause.isArmedFor(generation)
                    ) {
                        emitState("buffering")
                        scheduleUnpauseRetries(generation)
                    } else if (explicitLoading != null) {
                        MPVLib.setPropertyBoolean("pause", true)
                        emitState("paused")
                    } else if (preparedLoading != null) {
                        // 等 END_FILE 验证 playlist-pos 并提升 generation 后再允许 unpause。
                        emitState("buffering")
                    } else {
                        Log.d(TAG, "START_FILE ignored for stale/unidentified path")
                    }
                }
                MPVLib.MPV_EVENT_FILE_LOADED -> {
                    resolvePendingPreparedPromotion("FILE_LOADED")
                    val generation = currentLoadGeneration
                    val explicitIdentity = loadingTrackIdentity
                        ?.takeIf {
                            it.loadGeneration == generation && currentPathMatches(it.url)
                        }
                    val confirmedIdentity = activeTrackIdentity
                        ?.takeIf {
                            it.loadGeneration == generation && currentPathMatches(it.url)
                        }
                    if (explicitIdentity == null && confirmedIdentity == null) {
                        Log.d(TAG, "FILE_LOADED ignored for stale/unidentified path")
                        return@runMpvCallbackOnMain
                    }
                    if (loadingGeneration == generation) {
                        loadingGeneration = -1L
                    }
                    PerfMarks.mark("engine-file-loaded", "gen=$generation")
                    // 加载期间收到的跳转在开始出声前补上
                    val deferredSeek = pendingSeek.take(generation)
                    if (deferredSeek != null) {
                        try {
                            MPVLib.command(arrayOf("seek", deferredSeek.toString(), "absolute"))
                        } catch (e: Exception) {
                            Log.w(TAG, "deferred seek failed", e)
                            if (ownedAudioReturnIdentity?.loadGeneration == generation) {
                                failedAudioReturnGeneration = generation
                                pendingUnpause.cancel()
                                MPVLib.setPropertyBoolean("pause", true)
                                emitError("E_AUDIO_RETURN_SEEK", "Audio return seek failed")
                                return@runMpvCallbackOnMain
                            }
                        }
                    }
                    updateDurationFromMpv(seekingTo = deferredSeek)
                    explicitIdentity?.let { identity ->
                        replaceActiveIdentity(identity)
                        loadingTrackIdentity = null
                        videoOutput.refresh()
                        emitActiveTrackChanged(identity, "loaded")
                    }
                    if (pendingUnpause.isArmedFor(generation)) {
                        forceUnpause(generation)
                    } else {
                        MPVLib.setPropertyBoolean("pause", true)
                        emitState("paused")
                    }
                }
                MPVLib.MPV_EVENT_PLAYBACK_RESTART -> {
                    val identity = loadingTrackIdentity ?: activeTrackIdentity
                    if (identity == null || !currentPathMatches(identity.url)) {
                        return@runMpvCallbackOnMain
                    }
                    if (failedAudioReturnGeneration == currentLoadGeneration) return@runMpvCallbackOnMain
                    completedVideoIdentity = null
                    readyGeneration = currentLoadGeneration
                    if (ownedAudioReturnIdentity == identity) {
                        val raw = MPVLib.getPropertyDouble("time-pos")
                        val target = audioReturnPosition
                        if (raw == null || !raw.isFinite() || target == null || raw < target - 0.25) {
                            failedAudioReturnGeneration = currentLoadGeneration
                            readyGeneration = -1L
                            pendingUnpause.cancel()
                            MPVLib.setPropertyBoolean("pause", true)
                            emitError("E_AUDIO_RETURN_POSITION", "Audio return is not at its saved position")
                            return@runMpvCallbackOnMain
                        }
                        ownedAudioReturnIdentity = null
                        audioReturnPosition = null
                    }
                    updateDurationFromMpv()
                    val generation = currentLoadGeneration
                    if (pendingUnpause.isArmedFor(generation)) {
                        forceUnpause(generation)
                    }
                    if (renditionTrackingEnabled) emitProgress(force = true)
                }
                MPVLib.MPV_EVENT_END_FILE -> {
                    if (renditionTrackingEnabled && videoEndIdentity != activeTrackIdentity) {
                        Log.d(TAG, "END_FILE ignored for replaced rendition owner")
                        return@runMpvCallbackOnMain
                    }
                    val now = System.currentTimeMillis()
                    if (
                        stopRequested ||
                        now < ignoreEndFileUntilMs ||
                        loadingGeneration == currentLoadGeneration ||
                        pendingNaturalEnd != null
                    ) {
                        Log.d(TAG, "END_FILE suppressed")
                        return@runMpvCallbackOnMain
                    }
                    pendingUnpause.cancel()
                    loadingGeneration = -1L
                    val endedIdentity = if (renditionTrackingEnabled) videoEndIdentity else activeTrackIdentity
                    val pending = PendingNaturalEnd(
                        serial = ++naturalEndSerial,
                        endedIdentity = endedIdentity,
                        videoEndIdentity = videoEndIdentity,
                        endedKind = callbackKind,
                    )
                    pendingNaturalEnd = pending
                    val promotedTrack = promotePreparedTrack(
                        requireCurrentPath = true,
                    )
                    if (promotedTrack != null) {
                        completeNaturalEnd(pending, promotedTrack)
                    } else if (preparedTrack != null && hasPlaylistPreparedTrack) {
                        Log.d(
                            TAG,
                            "END_FILE waiting for prepared START_FILE: " +
                                "endedMediaId=${endedIdentity?.mediaId} " +
                                "preparedMediaId=${preparedTrack?.mediaId}",
                        )
                        suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
                        emitState("buffering")
                        schedulePendingPreparedPromotion(pending)
                    } else {
                        completeNaturalEnd(pending, null)
                    }
                }
                MPVLib.MPV_EVENT_SHUTDOWN -> {
                    Log.e(TAG, "MPV_EVENT_SHUTDOWN")
                    val error = MPVLib.getPropertyString("error")
                        ?: MPVLib.getPropertyString("playback-error")
                        ?: "mpv shutdown"
                    sendEvent(
                        ON_MPV_ERROR,
                        Arguments.createMap().apply {
                            putString("message", error)
                            putString("code", "mpv-shutdown")
                        },
                    )
                    emitState("error")
                }
            }
        }
    }
}
