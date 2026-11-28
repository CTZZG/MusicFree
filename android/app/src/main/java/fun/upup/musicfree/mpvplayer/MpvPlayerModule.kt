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
class MpvPlayerModule internal constructor(
    private val reactContext: ReactApplicationContext,
    engine: MpvEngine? = null,
    private val mapFactory: () -> WritableMap = { Arguments.createMap() },
    private val eventSink: ((String, WritableMap?) -> Unit)? = null,
) :
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

    private val engine: MpvEngine = engine ?: object : MpvEngine {
        override fun create(context: Context) {
            try { mpvInstance?.destroy() } finally { mpvInstance = null }
            mpvInstance = NativeMPVLib.create(context)
                ?: throw IllegalStateException("failed to create mpv instance")
        }
        override fun init() = requireMpv().init()
        override fun destroy() {
            try { mpvInstance?.destroy() } finally { mpvInstance = null }
        }
        override fun eventProtocolVersion() = requireMpv().getEventProtocolVersion()
        override fun command(command: Array<String>) = requireMpv().command(command)
        override fun loadFile(command: Array<String>) = requireMpv().loadFile(command)
        override fun setOptionString(name: String, value: String) = requireMpv().setOptionString(name, value)
        override fun getPropertyInt(name: String) = mpvInstance?.getPropertyInt(name)
        override fun getPropertyDouble(name: String) = mpvInstance?.getPropertyDouble(name)
        override fun getPropertyBoolean(name: String) = mpvInstance?.getPropertyBoolean(name)
        override fun getPropertyString(name: String) = mpvInstance?.getPropertyString(name)
        override fun setPropertyInt(name: String, value: Int) = requireMpv().setPropertyInt(name, value)
        override fun setPropertyDouble(name: String, value: Double) = requireMpv().setPropertyDouble(name, value)
        override fun setPropertyBoolean(name: String, value: Boolean) = requireMpv().setPropertyBoolean(name, value)
        override fun setPropertyString(name: String, value: String) = requireMpv().setPropertyString(name, value)
        override fun observeProperty(name: String, format: Int) = requireMpv().observeProperty(name, format)
        override fun addObserver(observer: NativeMPVLib.EventObserver) = requireMpv().addObserver(observer)
        override fun removeObserver(observer: NativeMPVLib.EventObserver) { mpvInstance?.removeObserver(observer) }
    }

    private fun createMap(): WritableMap = mapFactory()

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
            fileEvents.reset()
            appliedHeaderFields = ""
            appliedUserAgent = null
            fileEventProtocol = false
            ownedFileEntryId = null
            preparedFileEntryId = null
            engine.create(context)
        }

        fun init() {
            fileEventProtocol = try { engine.eventProtocolVersion() >= 2 } catch (_: LinkageError) { false }
            engine.init()
        }

        fun destroy() = engine.destroy()

        fun command(command: Array<String>) = engine.command(command)

        fun loadFile(command: Array<String>): Long? = if (fileEventProtocol) engine.loadFile(command) else {
            engine.command(command)
            null
        }

        fun setOptionString(name: String, value: String): Int {
            val result = engine.setOptionString(name, value)
            if (result >= 0) {
                if (name == "http-header-fields") appliedHeaderFields = value
                if (name == "user-agent") appliedUserAgent = value
            }
            return result
        }

        fun getPropertyInt(property: String): Int? =
            engine.getPropertyInt(property)

        fun setPropertyInt(property: String, value: Int) =
            engine.setPropertyInt(property, value)

        fun getPropertyDouble(property: String): Double? =
            engine.getPropertyDouble(property)

        fun setPropertyDouble(property: String, value: Double) =
            engine.setPropertyDouble(property, value)

        fun getPropertyBoolean(property: String): Boolean? =
            engine.getPropertyBoolean(property)

        fun setPropertyBoolean(property: String, value: Boolean) =
            engine.setPropertyBoolean(property, value)

        fun getPropertyString(property: String): String? =
            engine.getPropertyString(property)

        fun setPropertyString(property: String, value: String) =
            engine.setPropertyString(property, value)

        fun observeProperty(property: String, format: Int) =
            engine.observeProperty(property, format)

        fun addObserver(observer: NativeMPVLib.EventObserver) {
            val epoch = fileEvents.epoch
            val guarded = object : NativeMPVLib.EventObserver {
                private fun deliver(action: () -> Unit) {
                    synchronized(fileEvents) { if (epoch == fileEvents.epoch) action() }
                }
                override fun eventProperty(property: String) = deliver { observer.eventProperty(property) }
                override fun eventProperty(property: String, value: Long) = deliver { observer.eventProperty(property, value) }
                override fun eventProperty(property: String, value: Double) = deliver { observer.eventProperty(property, value) }
                override fun eventProperty(property: String, value: Boolean) = deliver { observer.eventProperty(property, value) }
                override fun eventProperty(property: String, value: String) = deliver { observer.eventProperty(property, value) }
                override fun event(eventId: Int) = deliver { observer.event(eventId) }
                override fun eventWithFile(eventId: Int, entryId: Long) = deliver { observer.eventWithFile(eventId, entryId) }
                override fun eventEndFile(reason: Int, error: Int, entryId: Long, insertId: Long, insertCount: Int) {
                    deliver { observer.eventEndFile(reason, error, entryId, insertId, insertCount) }
                }
            }
            fileObserver = guarded
            engine.addObserver(guarded)
        }

        fun removeObserver(observer: NativeMPVLib.EventObserver) {
            fileObserver?.let { engine.removeObserver(it) }
            fileObserver = null
        }
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
    private val fileEvents = MpvFileEvents<TrackIdentity>()
    @Volatile private var fileEventProtocol = false
    private var fileObserver: NativeMPVLib.EventObserver? = null
    @Volatile private var retiredForVideoNetwork = false
    @Volatile private var retiredForPlaybackFailure = false
    private fun retiredCode() = when {
        retiredForVideoNetwork -> "E_VIDEO_NETWORK_RETIRED"
        retiredForPlaybackFailure -> "E_MPV_ENGINE_RETIRED"
        else -> "E_NOT_INIT"
    }
    private var ownedFileEntryId: Long? = null
    private var preparedFileEntryId: Long? = null
    private var appliedHeaderFields = ""
    private var appliedUserAgent: String? = null
    private var lastVideoClock: Pair<TrackIdentity, Double>? = null
    private val engineProgressMarker = EngineProgressMarker()
    @Volatile private var activeTrackIdentity: TrackIdentity? = null
    // Accepted native MV load ownership also covers loading/failure, before
    // FILE_LOADED can confirm active identity. Only explicit zero/return may
    // replace it; preserve-MV still requires a live outgoing file/clock.
    private var ownedVideoIdentity: TrackIdentity? = null
    private var failedVideoIdentity: TrackIdentity? = null
    private var ownedAudioReturnIdentity: TrackIdentity? = null
    private var audioReturnPosition: Double? = null
    private var outgoingAudioPosition: Double? = null
    // Kept on the native playback thread so a prepared song can resume the
    // user's rate even when JS is backgrounded after an MV ends.
    private var audioPlaybackRate = 1.0
    @Volatile private var renditionTrackingEnabled = false
    private var readyGeneration = -1L
    private var failedAudioReturnGeneration = -1L
    private var videoNetworkPolicy: String? = null
    private val videoNetworkGate = VideoNetworkGate()
    private data class VideoNetworkOwner(val identity: TrackIdentity, val policy: String, val epoch: Long)
    private data class SuspendedVideo(val owner: TrackIdentity, val position: Double?, val timeline: String?, val videoIdentity: String?)
    @Volatile private var videoNetworkOwner: VideoNetworkOwner? = null
    private var suspendedVideo: SuspendedVideo? = null
    private var videoTimelineId: String? = null
    private var videoIdentity: String? = null
    private val connectivity by lazy { reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private fun videoNetworkAllowed(policy: String? = videoNetworkPolicy): Boolean {
        if (policy == null) return true
        watchVideoNetwork()
        return videoNetworkGate.allows(policy)
    }

    private fun audioNetworkRetryAllowed(): Boolean {
        watchVideoNetwork()
        return videoNetworkGate.allowsAudioRetry()
    }

    private fun watchVideoNetwork() {
        if (networkCallback != null) return
        val initial = connectivity.activeNetwork
        val caps = initial?.let { connectivity.getNetworkCapabilities(it) }
        videoNetworkGate.seed(initial?.networkHandle,
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true,
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val pendingEpoch = videoNetworkGate.available(network.networkHandle) ?: return
                // Android delivers capabilities after availability. Pending refuses
                // new loads; only a confirmed denial or bounded timeout stops one.
                mainHandler.postDelayed({
                    if (videoNetworkGate.expirePending(network.networkHandle, pendingEpoch)) checkVideoNetwork()
                }, 500L)
            }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                videoNetworkGate.capabilities(network.networkHandle,
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
                checkVideoNetwork()
                val watch = videoNetworkOwner
                if (watch != null && videoNetworkGate.allows(watch.policy)) mainHandler.post {
                    if (videoNetworkOwner === watch && isInitialized.get() &&
                        pendingUnpause.isArmedFor(watch.identity.loadGeneration)) forceUnpause(watch.identity.loadGeneration)
                }
            }
            override fun onLost(network: Network) {
                videoNetworkGate.lost(network.networkHandle)
                checkVideoNetwork()
            }
        }
        connectivity.registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }

    private fun checkVideoNetwork() {
        val owner = videoNetworkOwner ?: return
        if (!videoNetworkGate.denies(owner.policy)) return
        // The immutable owner fences late callbacks. Remember a real denial even
        // if Wi-Fi comes back before the main looper processes cancellation.
        mainHandler.post { suspendVideoForNetwork(owner) }
    }

    private fun suspendVideoForNetwork(watch: VideoNetworkOwner) {
        if (!isInitialized.get() || videoNetworkOwner !== watch || renditionKind != "mv" ||
            currentLoadGeneration != watch.identity.loadGeneration || completedVideoIdentity == watch.identity ||
            failedVideoIdentity == watch.identity || suspendedVideo?.owner == watch.identity) return
        val checkpoint = if (fileEvents.isMultipart(watch.identity)) null else
            readyPosition() ?: lastVideoClock?.takeIf { it.first == watch.identity }?.second ?:
                pendingSeek.peek(currentLoadGeneration)
        suspendedVideo = SuspendedVideo(watch.identity, checkpoint, videoTimelineId, videoIdentity)
        pendingUnpause.cancel()
        pendingSeek.reset()
        loadingGeneration = -1L
        readyGeneration = -1L
        pendingNaturalEnd = null
        fileEvents.discardPrepared()
        clearPreparedTrack(removeFromPlaylist = false)
        runCatching { MPVLib.setPropertyBoolean("pause", true) }
        Log.d(TAG, "video network stop requested: generation=${watch.identity.loadGeneration} policyEpoch=${watch.epoch}")
        try {
            MPVLib.command(arrayOf("stop"))
        } catch (error: Exception) {
            // Failure to cancel must not leave a potentially billable stream alive.
            Log.e(TAG, "video network cancellation failed", error)
            retiredForVideoNetwork = true
            isInitialized.set(false)
            videoOutput.clear()
            runCatching { MPVLib.destroy() }
        }
        if (isInitialized.get()) {
            runCatching { videoOutput.detach() }.onFailure { Log.w(TAG, "network suspension surface cleanup failed", it) }
        }
        emitState("paused", force = true)
        sendEvent(ON_MPV_ERROR, createMap().apply {
            putString("code", "E_VIDEO_NETWORK_BLOCKED")
            putString("message", "Video suspended by network policy")
        })
    }

    @ReactMethod
    fun setVideoNetworkPermission(allowed: Boolean, promise: Promise) {
        postPromise(promise, "E_VIDEO_NETWORK_POLICY") { result ->
            videoNetworkGate.permitMetered(allowed)
            checkVideoNetwork()
            result.resolve(null)
        }
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
                    it.mediaId == mediaId && it.loadGeneration == generation && currentIdentityMatches(it)
                } == true
        },
        onError = {
            sendEvent(ON_MPV_ERROR, createMap().apply {
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
        eventSink?.let { it(name, params); return }
        reactContext.getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(name, params ?: createMap())
    }

    private fun runMpvCallbackOnMain(action: () -> Unit) {
        val epoch = fileEvents.epoch
        val task = Runnable {
            if (isInitialized.get() && !invalidated.get() && epoch == fileEvents.epoch) {
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
            createMap().apply { putString("state", state); putEventIdentity(this) },
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

    private fun readyPosition(): Double? {
        val identity = activeTrackIdentity ?: return null
        if (readyGeneration != currentLoadGeneration || loadingTrackIdentity != null ||
            identity.loadGeneration != currentLoadGeneration || !currentIdentityMatches(identity)) return null
        return ownedPosition(identity, requireReady = true)
    }

    private fun ownedPosition(identity: TrackIdentity, requireReady: Boolean = false): Double? {
        if (!fileEventProtocol) return MPVLib.getPropertyDouble("time-pos")?.takeIf { it.isFinite() && it >= 0.0 }
        val position = OwnedMpvClock.read(identity, { currentPlaylistEntryId() },
            { id -> (if (requireReady) fileEvents.ready(id) else fileEvents.get(id)?.takeUnless { it.ended })?.owner },
            { MPVLib.getPropertyDouble("time-pos") })
        if (position != null && requireReady && renditionKind == "mv" && readyGeneration == currentLoadGeneration) lastVideoClock = identity to position
        return position
    }

    private fun emitProgress(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastProgressEmitMs < progressIntervalMs) {
            return
        }
        lastProgressEmitMs = now

        val readyRaw = readyPosition()
        if (readyRaw != null) positionSecs = readyRaw

        val bufferedSecs = bufferedPositionSecs()
        sendEvent(
            ON_MPV_PROGRESS,
            createMap().apply {
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
            createMap().apply { putBoolean("connected", connected) },
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
            createMap().apply {
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

    private fun currentPlaylistEntryId(): Long? {
        // playlist-pos may already select the successor while the core still
        // plays/tears down the previous file. Pin to the actual playing entry.
        val position = MPVLib.getPropertyInt("playlist-playing-pos")?.takeIf { it >= 0L } ?: return null
        val id = MPVLib.getPropertyString("playlist/$position/id")?.toLongOrNull() ?: return null
        return id.takeIf { MPVLib.getPropertyBoolean("playlist/$position/playing") == true &&
            MPVLib.getPropertyString("playlist/$position/id")?.toLongOrNull() == id }
    }

    private fun currentIdentityMatches(identity: TrackIdentity): Boolean = if (fileEventProtocol) {
        currentPlaylistEntryId()?.let { fileEvents.get(it)?.takeUnless { entry -> entry.ended }?.owner == identity } == true
    } else currentPathMatches(identity.url)

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

    private fun emitError(code: String, message: String, entryId: Long? = null, mpvError: Int? = null, mpvReason: String? = null) {
        emitState("error")
        sendEvent(ON_MPV_ERROR, createMap().apply {
            putString("code", code)
            putString("message", message)
            entryId?.let { putString("entryId", it.toString()) }
            mpvError?.let { putInt("mpvError", it) }
            mpvReason?.let { putString("mpvReason", it) }
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
        if (renditionKind == "mv" && !videoNetworkAllowed() && !videoNetworkGate.denies(videoNetworkPolicy)) return
        if (MpvServiceBridge.playbackHold.blocksAutoPlay || (renditionKind == "mv" && !videoNetworkAllowed())) {
            keepHeldPaused("unpause")
            return
        }
        if (suspendedVideo != null) {
            keepHeldPaused("video-suspended")
            return
        }
        val identity = loadingTrackIdentity
            ?.takeIf { it.loadGeneration == generation }
            ?: activeTrackIdentity?.takeIf { it.loadGeneration == generation }
        if (identity == null || !currentIdentityMatches(identity)) {
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
        preparedFileEntryId = null
        if (removeFromPlaylist) fileEvents.discardPrepared()
        // 队列里的曲目从未追加进 mpv playlist，直接丢弃即可，不需要 removePlaylistIndex。
        pendingPreparedQueue.clear()
    }

    private fun promotePreparedTrack(requireCurrentPath: Boolean = false): PreparedTrack? {
        val prepared = preparedTrack ?: return null
        val playlistPosition = readPlaylistPosition()
        val pathMatches = currentPathMatches(prepared.url)
        val currentPrepared = if (fileEventProtocol) {
            val currentId = currentPlaylistEntryId()
            val sourceId = preparedFileEntryId
            if (currentId != null && sourceId != null) fileEvents.preparedEntry(currentId, sourceId) else null
        } else null
        if (
            !hasPlaylistPreparedTrack ||
            (if (fileEventProtocol) currentPrepared == null else playlistPosition != preparedPlaylistIndex) ||
            (requireCurrentPath && !fileEventProtocol && !pathMatches)
        ) {
            Log.w(
                TAG,
                "prepared promotion rejected: pos=$playlistPosition expected=$preparedPlaylistIndex " +
                    "pathMatches=$pathMatches mediaId=${prepared.mediaId} " +
                    "token=${prepared.prepareToken}",
            )
            return null
        }
        if (currentPrepared != null) {
            fileEvents.promotePrepared(currentPrepared.id, preparedFileEntryId!!)
            ownedFileEntryId = currentPrepared.id
        } else ownedFileEntryId = preparedFileEntryId ?: ownedFileEntryId
        preparedFileEntryId = null
        preparedTrack = null
        hasPlaylistPreparedTrack = false
        preparedPlaylistIndex = -1
        pendingPlaylistCompaction = true
        videoOutput.detach()
        if (renditionKind == "mv") {
            MPVLib.setPropertyDouble("speed", audioPlaybackRate)
            Log.d(TAG, "prepared audio rate[${prepared.loadGeneration}]: requested=$audioPlaybackRate " +
                "actual=${MPVLib.getPropertyDouble("speed")}")
        }
        renditionKind = "audio"
        videoNetworkOwner = null
        suspendedVideo = null
        videoTimelineId = null
        videoIdentity = null
        lastVideoClock = null
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
        readyGeneration = if (currentPrepared?.loaded == true && currentPrepared.restarted) currentLoadGeneration else -1L
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
            createMap().apply {
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
                    if (!stopOwnedPlayback()) {
                        pendingNaturalEnd = null
                        emitError("E_MPV_STOP", "Could not stop unconfirmed prepared playback")
                        return@postDelayed
                    }
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
        failedVideoIdentity = null
        completedVideoIdentity = null
        loadingTrackIdentity = identity
    }

    private fun clearLoadingIdentity() {
        loadingTrackIdentity = null
    }

    private fun replaceActiveIdentity(identity: TrackIdentity) {
        failedVideoIdentity = null
        completedVideoIdentity = null
        activeTrackIdentity = identity
    }

    private fun clearActiveIdentity() {
        failedVideoIdentity = null
        videoIdentity = null
        lastVideoClock = null
        videoNetworkOwner = null
        suspendedVideo = null
        videoTimelineId = null
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
        retiredForVideoNetwork = false
        retiredForPlaybackFailure = false
        fileEvents.reset()
        ownedFileEntryId = null
        preparedFileEntryId = null
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
        MpvServiceBridge.deferRemotePlayClaim = null
        MpvServiceBridge.onBrowseRequest = null
        MpvServiceBridge.pauseNow = null
        unregisterAndroidAutoConnectionDetector(notifyJs = false)
        networkCallback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        networkCallback = null
        videoNetworkGate.clearNetwork()
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
                if (!retiredForVideoNetwork && !retiredForPlaybackFailure) MpvServiceBridge.clearPlaybackSession()
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
                if (appliedUserAgent == null) appliedUserAgent = MPVLib.getPropertyString("user-agent")
                MPVLib.addObserver(this@MpvPlayerModule)

                MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("time-pos", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("duration", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("idle-active", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty(
                    "demuxer-cache-duration",
                    MPVLib.MPV_FORMAT_DOUBLE,
                )

                startPlaybackService(foreground = false)

                // 新的播放会话：上一次的外部暂停、打断不再作数
                if (!retiredForVideoNetwork && !retiredForPlaybackFailure) MpvServiceBridge.playbackHold.claim()
                MpvServiceBridge.pauseNow = {
                    runMpvCallbackOnMain { keepHeldPaused("external") }
                }
                MpvServiceBridge.onBrowseRequest = { parentId, requestId ->
                    if (!invalidated.get()) {
                        sendEvent(
                            ON_MPV_BROWSE_REQUEST,
                            createMap().apply {
                                putString("parentId", parentId)
                                putString("requestId", requestId)
                            },
                        )
                    }
                }
                MpvServiceBridge.deferRemotePlayClaim = { renditionKind == "mv" }
                MpvServiceBridge.onCommand = { command, position, mediaId ->
                    if (!invalidated.get()) {
                        sendEvent(
                            ON_MPV_REMOTE_COMMAND,
                            createMap().apply {
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

                if ((retiredForVideoNetwork || retiredForPlaybackFailure) && renditionKind != "mv" &&
                    audioPlaybackRate.isFinite() && audioPlaybackRate > 0.0 && audioPlaybackRate != 1.0) {
                    MPVLib.setPropertyDouble("speed", audioPlaybackRate)
                }
                isInitialized.set(true)
                retiredForVideoNetwork = false
                retiredForPlaybackFailure = false
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
            promise.reject(retiredCode(), "not init")
            return
        }

        val url = readString(payload, "url")
        if (url.isNullOrBlank()) {
            promise.reject("E_NO_URL", "no URL")
            return
        }

        postPromise(promise, "E_LOAD") { operationPromise ->
            if (!isInitialized.get()) {
                operationPromise.reject(retiredCode(), "not init")
                return@postPromise
            }
            val restoreOrRestart = readString(payload, "positionMode") in listOf("restore-audio", "start-zero", "resume-suspended-mv")
            val outgoingIdentity = if (readString(payload, "positionMode") == "restore-audio" && ownedAudioReturnIdentity != null) {
                ownedAudioReturnIdentity
            } else if (restoreOrRestart && renditionKind == "mv") {
                ownedVideoIdentity ?: activeTrackIdentity
            } else activeTrackIdentity
            val outgoingKind = renditionKind
            val previousNetworkPolicy = videoNetworkPolicy
            val previousNetworkOwner = videoNetworkOwner
            val previousSuspended = suspendedVideo
            val previousTimeline = videoTimelineId
            val previousVideoIdentity = videoIdentity
            val previousFailedVideo = failedVideoIdentity
            val previousPrepared = preparedTrack
            val previousPreparedEntry = preparedFileEntryId
            val previousOwnedEntry = ownedFileEntryId
            val previousHasPrepared = hasPlaylistPreparedTrack
            val previousPreparedIndex = preparedPlaylistIndex
            val previousPreparedQueue = pendingPreparedQueue.toList()
            val previousLoadingIdentity = loadingTrackIdentity
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
            val previousAudioRate = audioPlaybackRate
            val previousBridgeSpeed = MpvServiceBridge.playbackSpeed
            val previousReadyGeneration = readyGeneration
            val previousFailedReturnGeneration = failedAudioReturnGeneration
            val previousLoadingGeneration = loadingGeneration
            val previousPendingSeek = pendingSeek.peek(currentLoadGeneration)
            val previousPendingUnpause = pendingUnpause.isArmedFor(currentLoadGeneration)
            val previousIgnoreEnd = ignoreEndFileUntilMs
            val previousSuppressIdle = suppressIdleUntilMs
            val previousHeaders = appliedHeaderFields
            val previousUserAgent = appliedUserAgent
            val previousNaturalEnd = pendingNaturalEnd
            val previousCompaction = pendingPlaylistCompaction
            val previousCompletedVideo = completedVideoIdentity
            var capturedForFailure: Double? = null
            val wasPaused = MPVLib.getPropertyBoolean("pause") != false
            val isRenditionRequest = payload.hasKey("positionMode") || payload.hasKey("renditionKind")
            var renditionMutationStarted = false
            var capturePaused = false
            var fileLoadScheduled = false
            try {
                // Observation protocol negotiation has no playback side effects.
                // It survives a rejected first MV, so ordinary/prepared audio and
                // JS agree about ready even when admission makes no source change.
                if (isRenditionRequest || readBoolean(payload, "requireRenditionProgress") == true) {
                    renditionTrackingEnabled = true
                }
                val nextKind = readString(payload, "renditionKind") ?: "audio"
                require(nextKind == "audio" || nextKind == "mv") { "invalid rendition kind" }
                val localVideoFile = Uri.parse(url).scheme == "file" || url.startsWith("/")
                val nextNetworkPolicy = readString(payload, "videoNetworkPolicy") ?: if (nextKind == "mv" && !localVideoFile) "unmetered" else null
                require(nextNetworkPolicy == null || nextNetworkPolicy in listOf("unmetered", "allow-metered")) { "invalid video network policy" }
                if (nextKind == "mv") {
                    require(fileEventProtocol) { "MV requires the file-event bridge protocol" }
                    require(readBoolean(payload, "requireForeground") != true || reactContext.lifecycleState == LifecycleState.RESUMED) { "MV requires foreground" }
                    require(videoNetworkAllowed(nextNetworkPolicy)) { "Video network unavailable" }
                }
                val sourceUri = Uri.parse(url)
                val trustedLocalProxy = readBoolean(payload, "trustedLocalMediaProxy") == true &&
                    sourceUri.scheme?.lowercase() == "http" && sourceUri.userInfo == null && sourceUri.port in 1..65535 &&
                    sourceUri.host?.lowercase() in listOf("127.0.0.1", "localhost")
                MpvHttpOptions.validateMediaUrl(
                    rawUrl = url,
                    renditionKind = nextKind,
                    trustedLocalProxy = trustedLocalProxy,
                    allowInsecureHttpExplicit = readBoolean(payload, "allowInsecureHttpPlayback"),
                )
                val networkRetry = readBoolean(payload, "retryAfterVideoNetworkRetirement") == true &&
                    !trustedLocalProxy && sourceUri.scheme?.lowercase() in listOf("http", "https")
                require(!networkRetry || (if (nextKind == "mv") videoNetworkAllowed("allow-metered") else audioNetworkRetryAllowed())) {
                    "Network changed before engine retry"
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
                    require(it in listOf("start-zero", "preserve-mv", "restore-audio", "resume-suspended-mv")) { "invalid position policy" }
                    require(it != "start-zero" || nextKind == "mv") { "start-zero is a video transition" }
                    val ownedVideoReplacement = outgoingKind == "mv" && outgoingIdentity == ownedVideoIdentity &&
                        it in listOf("restore-audio", "start-zero", "resume-suspended-mv")
                    require((loadingTrackIdentity == null || ownedVideoReplacement || retryAudioReturn) && outgoingIdentity != null &&
                        outgoingIdentity.mediaId == readString(payload, "expectedMediaId") &&
                        outgoingIdentity.loadGeneration == readLong(payload, "expectedLoadGeneration") &&
                        currentLoadGeneration == outgoingIdentity.loadGeneration) {
                        "stale rendition replacement"
                    }
                    require(it != "preserve-mv" || (outgoingKind == "mv" && nextKind == "mv")) { "invalid video replacement" }
                    if (it == "resume-suspended-mv") {
                        val held = suspendedVideo
                        require(nextKind == "mv" && held != null && held.owner == outgoingIdentity && held.position != null &&
                            held.timeline != null && held.timeline == readString(payload, "videoTimelineId") &&
                            held.videoIdentity != null && held.videoIdentity == readString(payload, "videoIdentity")) { "Video resume checkpoint unavailable" }
                        return@let held.position
                    }
                    val completedVideo = outgoingKind == "mv" && completedVideoIdentity == outgoingIdentity
                    val liveFile = currentIdentityMatches(outgoingIdentity) &&
                        MPVLib.getPropertyBoolean("idle-active") != true && MPVLib.getPropertyBoolean("eof-reached") != true
                    require(liveFile || ownedVideoReplacement || retryAudioReturn || (completedVideo && it != "preserve-mv")) { "stale rendition replacement" }
                    // Capture after pausing the actual outgoing file, beside loadfile. No JS fallback.
                    // A completed MV needs no outgoing clock for a new zero start or
                    // the already captured audio return. Audio entry/preserve remain live-only.
                    if ((completedVideo || ownedVideoReplacement || retryAudioReturn) && !liveFile) return@let null
                    if (it == "restore-audio" || (it == "start-zero" && outgoingKind == "mv")) return@let null
                    require(!fileEvents.isMultipart(outgoingIdentity)) { "Segmented video requires an explicit restart" }
                    require(readyPosition() != null) { "outgoing engine clock is not ready" }
                    capturePaused = true
                    MPVLib.setPropertyBoolean("pause", true)
                    ownedPosition(outgoingIdentity, requireReady = true)
                        ?: throw IllegalStateException("outgoing engine position unavailable")
                }
                val previousIdentity = loadingTrackIdentity ?: activeTrackIdentity
                if (outgoingKind == "audio" && nextKind == "mv") capturedForFailure = capturedPosition
                val previousDeferredPosition = if (loadingGeneration == currentLoadGeneration) {
                    pendingSeek.peek(currentLoadGeneration)
                } else null
                val preserveFallback = readDouble(payload, "preservePositionFallback")
                    ?.takeIf { it.isFinite() && it >= 0.0 }
                val livePrevious = previousIdentity != null && currentIdentityMatches(previousIdentity) &&
                    MPVLib.getPropertyBoolean("idle-active") != true && MPVLib.getPropertyBoolean("eof-reached") != true
                if (preserveFallback != null && previousIdentity?.mediaId == readString(payload, "mediaId") &&
                    previousDeferredPosition == null && livePrevious) {
                    require(readyPosition() != null) { "outgoing audio clock is not ready" }
                }
                val headers =
                    if (payload.hasKey("headers") && !payload.isNull("headers")) {
                        payload.getMap("headers")
                    } else {
                        null
                    }
                val trackUserAgent = readString(payload, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                val headerFieldsList = buildHeaderString(headers)
                val effectiveUserAgent = trackUserAgent ?: defaultUserAgent
                renditionMutationStarted = true
                if (!fileEventProtocol) {
                    MPVLib.setOptionString("http-header-fields", headerFieldsList)
                    effectiveUserAgent?.let { MPVLib.setOptionString("user-agent", it) }
                }

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
                videoTimelineId = if (nextKind == "mv") readString(payload, "videoTimelineId") else null
                videoIdentity = if (nextKind == "mv") readString(payload, "videoIdentity") else null
                videoNetworkOwner = if (nextKind == "mv" && nextNetworkPolicy != null) VideoNetworkOwner(loadingTrackIdentity!!, nextNetworkPolicy, videoNetworkGate.epoch) else null
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
                    "resume-suspended-mv" -> capturedPosition
                    "start-zero" -> 0.0
                    else -> null
                }
                renditionStart?.let { pendingSeek.defer(generation, it); positionSecs = it }
                if (nextKind == "mv") {
                    MPVLib.setPropertyDouble("speed", 1.0)
                    syncServicePlaybackSpeed(1.0f)
                } else {
                    val targetRate = playbackRate ?: audioPlaybackRate
                    val resolvedRate =
                        if (targetRate.isFinite() && targetRate > 0.0) targetRate else 1.0
                    syncServicePlaybackSpeed(resolvedRate.toFloat())
                    if (playbackRate != null || (targetRate.isFinite() && targetRate > 0.0 && targetRate != 1.0)) {
                        MPVLib.setPropertyDouble("speed", targetRate)
                        audioPlaybackRate = targetRate
                    }
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
                            (previousDeferredPosition != null || currentIdentityMatches(previousIdentity)),
                        pause = { MPVLib.setPropertyBoolean("pause", true) },
                        position = {
                            // Natural advancement must not assign a different file's position.
                            previousIdentity?.takeIf { currentIdentityMatches(it) }
                                ?.let { ownedPosition(it, requireReady = true) }
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
                PerfMarks.mark("engine-load", "gen=$generation source=${mediaSourceType(url)}")
                require(nextKind != "mv" || videoNetworkAllowed(nextNetworkPolicy)) { "Video network unavailable before load" }
                require(!networkRetry || (if (nextKind == "mv") videoNetworkAllowed("allow-metered") else audioNetworkRetryAllowed())) {
                    "Network changed before engine retry"
                }
                val loadCommand = if (fileEventProtocol) {
                    MpvHttpOptions.buildLoadFileCommand(url, "replace", headerFieldsList, effectiveUserAgent)
                } else {
                    arrayOf("loadfile", url, "replace")
                }
                MPVLib.loadFile(loadCommand)?.let { entryId ->
                    val identity = loadingTrackIdentity ?: error("Missing committed file owner")
                    fileEvents.replace(entryId, identity, nextKind)
                    ownedFileEntryId = entryId
                }
                fileLoadScheduled = true
                engineProgressMarker.onLoad(generation)
                suspendedVideo = null
                if (nextKind != "mv") lastVideoClock = null
                if (autoPlay) {
                    startPlaybackService(foreground = true)
                    scheduleUnpauseRetries(generation)
                } else {
                    MPVLib.setPropertyBoolean("pause", true)
                    emitState("paused", force = true)
                }
                if (mode != null) {
                    // Bounded source transitions only; never log URLs, headers or plugin credentials.
                    Log.d(TAG, "rendition committed[$generation]: kind=$nextKind mode=$mode " +
                        "captured=$capturedPosition target=$renditionStart " +
                        "instance=${mpvInstance?.let { System.identityHashCode(it) } ?: 0}")
                }
                operationPromise.resolve(if (mode == "start-zero") capturedPosition else renditionStart ?: restoredPosition)
            } catch (e: Exception) {
                var rolledBack = false
                if (capturePaused && !renditionMutationStarted && outgoingIdentity != null && currentIdentityMatches(outgoingIdentity)) {
                    MPVLib.setPropertyBoolean("pause", wasPaused || MpvServiceBridge.playbackHold.blocksAutoPlay ||
                        (outgoingKind == "mv" && !videoNetworkAllowed(previousNetworkPolicy)))
                }
                // A rejected stale/invalid request has no ownership over another load's
                // identity, seek or pending unpause. Roll back only work this call began.
                if (renditionMutationStarted) {
                    clearLoadingIdentity()
                    if (readString(payload, "positionMode") != null && outgoingIdentity != null &&
                        (!fileLoadScheduled || currentIdentityMatches(outgoingIdentity))) {
                        currentLoadGeneration = outgoingIdentity.loadGeneration
                        loadingGeneration = previousLoadingGeneration
                        pendingUnpause.cancel()
                        pendingSeek.reset()
                        previousPendingSeek?.let { pendingSeek.defer(outgoingIdentity.loadGeneration, it) }
                        ignoreEndFileUntilMs = previousIgnoreEnd
                        suppressIdleUntilMs = previousSuppressIdle
                        failedAudioReturnGeneration = previousFailedReturnGeneration
                        pendingNaturalEnd = previousNaturalEnd
                        pendingPlaylistCompaction = previousCompaction
                        completedVideoIdentity = previousCompletedVideo
                        if (!fileEventProtocol) {
                            MPVLib.setOptionString("http-header-fields", previousHeaders)
                            previousUserAgent?.let { MPVLib.setOptionString("user-agent", it) }
                        }
                        renditionKind = outgoingKind
                        videoNetworkPolicy = previousNetworkPolicy
                        videoNetworkOwner = previousNetworkOwner
                        suspendedVideo = previousSuspended
                        videoTimelineId = previousTimeline
                        videoIdentity = previousVideoIdentity
                        failedVideoIdentity = previousFailedVideo
                        preparedTrack = previousPrepared
                        preparedFileEntryId = previousPreparedEntry
                        ownedFileEntryId = previousOwnedEntry
                        hasPlaylistPreparedTrack = previousHasPrepared
                        preparedPlaylistIndex = previousPreparedIndex
                        pendingPreparedQueue.clear()
                        pendingPreparedQueue.addAll(previousPreparedQueue)
                        loadingTrackIdentity = previousLoadingIdentity
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
                        audioPlaybackRate = previousAudioRate
                        syncServicePlaybackSpeed(previousBridgeSpeed)
                        if (previousPendingUnpause && !MpvServiceBridge.playbackHold.blocksAutoPlay) {
                            pendingUnpause.arm(outgoingIdentity.loadGeneration)
                            scheduleUnpauseRetries(outgoingIdentity.loadGeneration)
                        }
                        if (!wasPaused && !MpvServiceBridge.playbackHold.blocksAutoPlay &&
                            (outgoingKind != "mv" || videoNetworkAllowed(previousNetworkPolicy))) {
                            MPVLib.setPropertyBoolean("pause", false)
                        }
                        videoOutput.refresh()
                        syncMetadata()
                        emitState(if (wasPaused || MpvServiceBridge.playbackHold.blocksAutoPlay ||
                            (outgoingKind == "mv" && !videoNetworkAllowed(previousNetworkPolicy))) "paused" else previousState, force = true)
                        rolledBack = true
                    }
                }
                Log.e(TAG, "loadAndPlay failed", e)
                operationPromise.reject(
                    if (rolledBack) "E_RENDITION_ROLLED_BACK" else if (isRenditionRequest && !renditionMutationStarted) "E_RENDITION_REJECTED" else "E_LOAD",
                    e.message, e,
                    createMap().apply {
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
    private fun parsePreparedTrack(map: ReadableMap, url: String): PreparedTrack {
        val sourceUri = Uri.parse(url)
        val trustedLocalProxy = readBoolean(map, "trustedLocalMediaProxy") == true &&
            sourceUri.scheme?.lowercase() == "http" && sourceUri.userInfo == null && sourceUri.port in 1..65535 &&
            sourceUri.host?.lowercase() in listOf("127.0.0.1", "localhost")
        MpvHttpOptions.validateMediaUrl(
            rawUrl = url,
            renditionKind = "audio",
            trustedLocalProxy = trustedLocalProxy,
            allowInsecureHttpExplicit = readBoolean(map, "allowInsecureHttpPlayback"),
        )
        return PreparedTrack(
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
    }

    private fun requirePrepareOwner(mediaId: String?, generation: Long?) {
        require(suspendedVideo == null) { "Video network is suspended" }
        require(renditionKind != "mv" || videoNetworkAllowed()) { "Video network unavailable" }
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
        val effectiveUserAgent = userAgent ?: defaultUserAgent
        if (!fileEventProtocol) {
            MPVLib.setOptionString("http-header-fields", headerString)
            effectiveUserAgent?.let { MPVLib.setOptionString("user-agent", it) }
        }

        val appendIndex = readPlaylistCount()
        val appendCommand = if (fileEventProtocol) {
            MpvHttpOptions.buildLoadFileCommand(prepared.url, "append", headerString, effectiveUserAgent)
        } else {
            arrayOf("loadfile", prepared.url, "append")
        }
        MPVLib.loadFile(appendCommand)?.let { entryId ->
            val sourceId = ownedFileEntryId ?: error("Prepared source has no file ID")
            fileEvents.append(entryId, TrackIdentity(prepared.url, prepared.mediaId, prepared.loadGeneration,
                prepared.prepareToken, prepared.queueRevision), sourceId)
            preparedFileEntryId = entryId
        }
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
                if (payload?.let { readBoolean(it, "requireRenditionProgress") } == true) renditionTrackingEnabled = true
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
                if (payloads != null && payloads.size() > 0 &&
                    payloads.getMap(0)?.let { readBoolean(it, "requireRenditionProgress") } == true) renditionTrackingEnabled = true
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
        if (!isInitialized.get() && !retiredForVideoNetwork && !retiredForPlaybackFailure) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        postPromise(promise, "E_PAUSE") { operationPromise ->
            if (!isInitialized.get() && !retiredForVideoNetwork && !retiredForPlaybackFailure) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                // 明确暂停：撤销还排着的自动取消暂停，免得几百毫秒后又被放出来
                pendingUnpause.cancel()
                if (isInitialized.get()) MPVLib.setPropertyBoolean("pause", true)
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
                if (suspendedVideo != null) {
                    keepHeldPaused("video-suspended")
                    operationPromise.resolve(null)
                    return@postPromise
                }
                val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                if (idle && loadingGeneration != currentLoadGeneration) {
                    // The adapter owns the source's headers/admission and must
                    // allocate a fresh generation. Global mpv options may now
                    // belong to a previously appended prepared song.
                    operationPromise.reject("E_MPV_RELOAD_REQUIRED", "Current audio file must be reloaded")
                    return@postPromise
                } else if (!idle && currentState == "ended") {
                    try {
                        MPVLib.command(arrayOf("seek", "0", "absolute"))
                    } catch (_: Exception) {
                        operationPromise.reject("E_MPV_RELOAD_REQUIRED", "Current audio file must be reloaded")
                        return@postPromise
                    }
                }
                startPlaybackService(foreground = true)
                val generation = currentLoadGeneration
                pendingUnpause.arm(generation)
                scheduleUnpauseRetries(generation)
                emitState(if (loadingGeneration == generation) "buffering" else "playing")
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
            require(suspendedVideo == null) { "Suspended video must be reloaded from its owned checkpoint" }
            videoNetworkPolicy = policy
            watchVideoNetwork()
            videoNetworkOwner = VideoNetworkOwner(owner, policy!!, videoNetworkGate.epoch)
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
    fun holdPlayback(promise: Promise) {
        postPromise(promise, "E_HOLD") { result ->
            MpvServiceBridge.playbackHold.pauseInApp()
            pendingUnpause.cancel()
            result.resolve(null)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        postPromise(promise, "E_STOP") { operationPromise ->
            if (!isInitialized.get() && !retiredForVideoNetwork && !retiredForPlaybackFailure) {
                operationPromise.reject("E_NOT_INIT", "not init")
                return@postPromise
            }
            try {
                stopRequested = true
                fileEvents.clear()
                ownedFileEntryId = null
                preparedFileEntryId = null
                videoOutput.detach()
                renditionKind = "audio"
                pendingPlaylistCompaction = false
                pendingNaturalEnd = null
                clearPreparedTrack(removeFromPlaylist = true)
                clearActiveIdentity()
                clearLoadingIdentity()
                if (retiredForVideoNetwork) {
                    retiredForVideoNetwork = false
                    retiredForPlaybackFailure = true
                }
                loadingGeneration = -1L
                pendingUnpause.cancel()
                ignoreEndFileUntilMs = System.currentTimeMillis() + END_FILE_SUPPRESS_MS
                if (isInitialized.get()) MPVLib.command(arrayOf("stop"))
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
                require(suspendedVideo == null) { "Video network is suspended" }
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
                require(rate.isFinite() && rate > 0.0) { "invalid playback rate" }
                if (renditionKind != "mv") {
                    MPVLib.setPropertyDouble("speed", rate)
                    syncServicePlaybackSpeed(rate.toFloat())
                }
                audioPlaybackRate = rate
                operationPromise.resolve(null)
            } catch (e: Exception) {
                operationPromise.reject("E_RATE", e.message, e)
            }
        }
    }

    private fun syncServicePlaybackSpeed(speed: Float) {
        val service = MpvServiceBridge.service
        if (service != null) {
            service.onPlaybackSpeedChanged(speed)
        } else {
            MpvServiceBridge.playbackSpeed = speed
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
            result.resolve(createMap().apply {
                putString("mediaId", identity?.mediaId)
                putDouble("loadGeneration", currentLoadGeneration.toDouble())
                putString("kind", renditionKind)
                putBoolean("completed", identity != null && completedVideoIdentity == identity)
                putBoolean("failed", identity != null && failedVideoIdentity == identity)
                putBoolean("suspended", suspendedVideo?.owner == identity && identity != null)
                putBoolean("suspendedPositionAvailable", suspendedVideo?.takeIf { it.owner == identity }?.position != null)
                putBoolean("positionPreservable", identity != null && !fileEvents.isMultipart(identity))
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
            result.resolve(createMap().apply {
                putEventIdentity(this)
                val raw = readyPosition()
                putBoolean("ready", raw != null)
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
                    MPVLib.getPropertyBoolean("idle-active") == true || !currentIdentityMatches(identity)) {
                    operationPromise.resolve(null)
                    return@postPromise
                }
                val info = DecodedAudioInfo.read(MPVLib::getPropertyString, MPVLib::getPropertyDouble)
                if (activeTrackIdentity != identity || !currentIdentityMatches(identity)) {
                    operationPromise.resolve(null)
                    return@postPromise
                }
                operationPromise.resolve(createMap().apply {
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
        val raw = linkedMapOf<String, String?>()
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            raw[key] = readString(headers, key)
        }
        return MpvHttpOptions.encodeHeaderFieldsOption(raw)
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
            if (suspendedVideo != null) return@runOwnedPropertyOnMain
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
                if (!currentIdentityMatches(identity)) return@runOwnedPropertyOnMain
            }
            val value = (if (renditionTrackingEnabled && property == "time-pos") {
                val identity = activeTrackIdentity ?: return@runOwnedPropertyOnMain
                if (loadingTrackIdentity != null || readyGeneration != currentLoadGeneration ||
                    identity.loadGeneration != currentLoadGeneration) return@runOwnedPropertyOnMain
                ownedPosition(identity, requireReady = true)
            } else if (renditionTrackingEnabled) MPVLib.getPropertyDouble(property) else observed)
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

    override fun eventProperty(property: String, value: String) = Unit

    override fun eventWithFile(eventId: Int, entryId: Long) {
        val epoch = fileEvents.epoch
        runMpvCallbackOnMain {
            if (epoch != fileEvents.epoch) return@runMpvCallbackOnMain
            val file = when (eventId) {
                MPVLib.MPV_EVENT_START_FILE -> fileEvents.start(entryId)
                MPVLib.MPV_EVENT_FILE_LOADED -> fileEvents.loaded(entryId)
                MPVLib.MPV_EVENT_PLAYBACK_RESTART -> fileEvents.restarted(entryId)
                else -> fileEvents.get(entryId)?.takeUnless { it.ended }
            } ?: return@runMpvCallbackOnMain
            if (suspendedVideo?.owner == file.owner) return@runMpvCallbackOnMain
            // Only a validated EOF may publish a prepared promotion. ERROR can
            // arrive after mpv has physically started that same successor.
            if (file.prepared && file.owner != activeTrackIdentity && pendingNaturalEnd == null) return@runMpvCallbackOnMain
            if (!file.prepared && file.owner != loadingTrackIdentity && file.owner != activeTrackIdentity) return@runMpvCallbackOnMain
            if (file.owner == loadingTrackIdentity || file.owner == activeTrackIdentity) ownedFileEntryId = entryId
            handleMpvEvent(eventId, file.owner, file.kind)
        }
    }

    override fun eventEndFile(reason: Int, error: Int, entryId: Long, insertId: Long, insertCount: Int) {
        val epoch = fileEvents.epoch
        runMpvCallbackOnMain {
            if (stopRequested) return@runMpvCallbackOnMain
            val terminal = fileEvents.end(epoch, entryId, reason, error, insertId, insertCount) ?: return@runMpvCallbackOnMain
            if (suspendedVideo?.owner == terminal.file.owner) {
                if (terminal.reason != MpvFileEvents.Reason.REDIRECT) {
                    Log.d(TAG, "video network stop confirmed: generation=${terminal.file.owner.loadGeneration} reason=${terminal.reason}")
                }
                return@runMpvCallbackOnMain
            }
            val watch = videoNetworkOwner
            if (terminal.file.kind == "mv" && watch != null && watch.identity == terminal.file.owner && videoNetworkGate.denies(watch.policy)) {
                suspendVideoForNetwork(watch)
                return@runMpvCallbackOnMain
            }
            when (terminal.reason) {
                MpvFileEvents.Reason.EOF -> {
                    if (fileEvents.hasContinuation(terminal.file)) {
                        // One logical source can redirect into several entries.
                        // The next segment must establish its own loaded/restart clock.
                        readyGeneration = -1L
                        if (currentState in listOf("playing", "buffering") && !MpvServiceBridge.playbackHold.blocksAutoPlay) {
                            pendingUnpause.arm(currentLoadGeneration)
                        }
                        return@runMpvCallbackOnMain
                    }
                    if (terminal.file.kind == "mv" && !terminal.file.loaded) {
                        failOwnedFile(terminal)
                    } else handleMpvEvent(MPVLib.MPV_EVENT_END_FILE, terminal.file.owner, terminal.file.kind)
                }
                MpvFileEvents.Reason.ERROR, MpvFileEvents.Reason.UNKNOWN -> failOwnedFile(terminal)
                MpvFileEvents.Reason.STOP, MpvFileEvents.Reason.QUIT, MpvFileEvents.Reason.REDIRECT -> Unit
            }
        }
    }

    private fun failOwnedFile(terminal: MpvFileEvents.End<TrackIdentity>) {
        val owner = terminal.file.owner
        if (owner.loadGeneration != currentLoadGeneration ||
            (owner != activeTrackIdentity && owner != loadingTrackIdentity)) return
        if (fileEvents.explicitRoot != terminal.file.rootId) return
        pendingUnpause.cancel()
        pendingNaturalEnd = null
        loadingGeneration = -1L
        readyGeneration = -1L
        completedVideoIdentity = null
        if (terminal.file.kind == "mv") {
            failedVideoIdentity = owner
            videoNetworkOwner = null
        }
        if (ownedAudioReturnIdentity == owner) failedAudioReturnGeneration = currentLoadGeneration
        fileEvents.discardPrepared()
        clearPreparedTrack(removeFromPlaylist = false)
        // Never stop a newer explicit song. Only this accepted root can own an
        // already-started automatic successor when its predecessor failed.
        stopOwnedPlayback()
        runCatching { videoOutput.detach() }.onFailure { Log.w(TAG, "failed file surface cleanup failed", it) }
        val errorCode = if (terminal.file.kind == "mv" && !terminal.file.loaded) "E_VIDEO_LOAD_FAILED" else "E_MPV_FILE_END"
        emitError(errorCode, "Playback failed (mpv error " + terminal.error + ")",
            terminal.file.id, terminal.error, terminal.reason.name.lowercase())
    }

    private fun stopOwnedPlayback(): Boolean {
        pendingUnpause.cancel()
        runCatching { MPVLib.setPropertyBoolean("pause", true) }
        return try {
            MPVLib.command(arrayOf("stop"))
            true
        } catch (error: Exception) {
            Log.e(TAG, "Failed playback cancellation; retiring engine", error)
            retiredForPlaybackFailure = true
            isInitialized.set(false)
            videoOutput.clear()
            runCatching { MPVLib.destroy() }
            false
        }
    }

    override fun event(eventId: Int) {
        if (fileEventProtocol && eventId in listOf(MPVLib.MPV_EVENT_START_FILE,
                MPVLib.MPV_EVENT_FILE_LOADED, MPVLib.MPV_EVENT_PLAYBACK_RESTART, MPVLib.MPV_EVENT_END_FILE)) return
        handleMpvEvent(eventId)
    }

    private fun handleMpvEvent(eventId: Int, eventOwner: TrackIdentity? = null, eventKind: String? = null) {
        // Capture a legacy observer's owner at receipt. Protocol 2 supplies
        // the validated identity from the file entry instead.
        val videoEndIdentity = if (eventId == MPVLib.MPV_EVENT_END_FILE) eventOwner ?: activeTrackIdentity else null
        val callbackKind = eventKind ?: renditionKind
        runMpvCallbackOnMain {
            when (eventId) {
                NativeMPVLib.MpvEvent.MPV_EVENT_SEEK -> {
                    // Record the actual event without logging libmpv message text or media URLs.
                    if (renditionKind == "mv") Log.i(TAG, "MV seek event")
                }
                MPVLib.MPV_EVENT_START_FILE -> {
                    val explicitLoading = loadingTrackIdentity
                        ?.takeIf { if (eventOwner != null) it == eventOwner else currentPathMatches(it.url) }
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
                            it.loadGeneration == generation && (if (eventOwner != null) it == eventOwner else currentPathMatches(it.url))
                        }
                    val confirmedIdentity = activeTrackIdentity
                        ?.takeIf {
                            it.loadGeneration == generation && (if (eventOwner != null) it == eventOwner else currentPathMatches(it.url))
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
                            if (renditionKind == "mv") {
                                failedVideoIdentity = ownedVideoIdentity
                                readyGeneration = -1L
                                pendingUnpause.cancel()
                                MPVLib.setPropertyBoolean("pause", true)
                                runCatching { MPVLib.command(arrayOf("stop")) }
                                emitError("E_VIDEO_SEEK", "Video seek failed")
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
                    if (identity == null || (eventOwner != null && identity != eventOwner) || !currentIdentityMatches(identity)) {
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
                    if (renditionTrackingEnabled) {
                        Log.d(TAG, "rendition ready[$generation]: kind=$renditionKind " +
                            "position=${MPVLib.getPropertyDouble("time-pos")} paused=${MPVLib.getPropertyBoolean("pause")} " +
                            "videoCodec=${MPVLib.getPropertyString("video-codec")?.substringBefore(" ")} " +
                            "width=${MPVLib.getPropertyInt("width")} height=${MPVLib.getPropertyInt("height")} " +
                            "vo=${MPVLib.getPropertyString("current-vo")} hwdec=${MPVLib.getPropertyString("hwdec-current")}")
                    }
                }
                MPVLib.MPV_EVENT_END_FILE -> {
                    if (renditionTrackingEnabled && videoEndIdentity != activeTrackIdentity) {
                        Log.d(TAG, "END_FILE ignored for replaced rendition owner")
                        return@runMpvCallbackOnMain
                    }
                    val now = System.currentTimeMillis()
                    if (
                        stopRequested ||
                        (eventOwner == null && now < ignoreEndFileUntilMs) ||
                        (eventOwner == null && loadingGeneration == currentLoadGeneration) ||
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
                    val error = "mpv shutdown"
                    sendEvent(
                        ON_MPV_ERROR,
                        createMap().apply {
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
