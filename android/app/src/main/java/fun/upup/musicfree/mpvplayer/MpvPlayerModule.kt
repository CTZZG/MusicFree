package `fun`.upup.musicfree.mpvplayer

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import dev.jdtech.mpv.MPVLib as NativeMPVLib
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
class MpvPlayerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    NativeMPVLib.EventObserver {

    private val isInitialized = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var mpvInstance: NativeMPVLib? = null

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
    )

    private var positionSecs = 0.0
    private var durationSecs = 0.0
    private var cacheAheadSecs = 0.0
    private var currentState = "idle"

    private var currentLoadGeneration = 0L
    private var activeTrackIdentity: TrackIdentity? = null
    private var loadingTrackIdentity: TrackIdentity? = null
    private var loadingGeneration = -1L
    private var pendingUnpauseGeneration = -1L
    private var ignoreEndFileUntilMs = 0L
    private var suppressIdleUntilMs = 0L
    private var stopRequested = false

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
    private var pendingPlaylistCompaction = false
    private var pendingNaturalEnd: PendingNaturalEnd? = null
    private var naturalEndSerial = 0L
    private var androidAutoConnectionDetector: MpvAndroidAutoConnectionDetector? = null
    private var isAndroidAutoConnected = false

    companion object {
        private const val TAG = "MpvPlayerModule"
        private const val ON_MPV_STATE_CHANGED = "onMpvStateChanged"
        private const val ON_MPV_PROGRESS = "onMpvProgress"
        private const val ON_MPV_ENDED = "onMpvEnded"
        private const val ON_MPV_ACTIVE_TRACK_CHANGED = "onMpvActiveTrackChanged"
        private const val ON_MPV_ERROR = "onMpvError"
        private const val ON_MPV_REMOTE_COMMAND = "onMpvRemoteCommand"
        private const val ON_MPV_ANDROID_AUTO_CONNECTION_CHANGED =
            "onMpvAndroidAutoConnectionChanged"
        private const val END_FILE_SUPPRESS_MS = 1200L
        private const val NATURAL_END_DEDUP_MS = 350L
        private val PLAYLIST_COMPACT_DELAYS_MS = longArrayOf(0L, 120L, 500L)
        private val PREPARED_PROMOTION_RETRY_DELAYS_MS =
            longArrayOf(0L, 24L, 80L, 220L, 600L, 1200L)
        private val UNPAUSE_RETRY_DELAYS_MS = longArrayOf(0L, 80L, 250L, 700L)
    }

    override fun getName() = "MpvPlayer"

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required by NativeEventEmitter.
    }

    private fun sendEvent(name: String, params: WritableMap?) {
        reactContext.getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(name, params ?: Arguments.createMap())
    }

    private fun runMpvCallbackOnMain(action: () -> Unit) {
        val task = Runnable {
            if (isInitialized.get()) {
                action()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            task.run()
        } else {
            mainHandler.post(task)
        }
    }

    private fun startPlaybackService(foreground: Boolean) {
        val intent = Intent(reactContext, MpvPlaybackService::class.java).apply {
            if (foreground) {
                action = MpvPlaybackService.ACTION_START_FOREGROUND
            }
        }
        try {
            if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
            Arguments.createMap().apply { putString("state", state) },
        )
        MpvServiceBridge.service?.onPlaybackStateChanged(state)
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

        val bufferedSecs = bufferedPositionSecs()
        sendEvent(
            ON_MPV_PROGRESS,
            Arguments.createMap().apply {
                putDouble("position", positionSecs)
                putDouble("duration", durationSecs)
                putDouble("buffered", bufferedSecs)
            },
        )
        MpvServiceBridge.service?.onProgressChanged(
            positionSecs,
            durationSecs,
            bufferedSecs,
        )
    }

    private fun syncMetadata() {
        MpvServiceBridge.service?.onMetadataChanged(
            cachedTitle,
            cachedArtist,
            cachedAlbum,
            cachedArtwork,
            durationSecs,
        )
    }

    private fun setAndroidAutoConnected(connected: Boolean, force: Boolean = false) {
        if (!force && isAndroidAutoConnected == connected) return
        isAndroidAutoConnected = connected
        MpvServiceBridge.isAndroidAutoConnected = connected
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
                    mainHandler.post { setAndroidAutoConnected(connected) }
                }
                register()
            }
    }

    private fun unregisterAndroidAutoConnectionDetector() {
        androidAutoConnectionDetector?.unregister()
        androidAutoConnectionDetector = null
        setAndroidAutoConnected(false)
    }

    private fun readString(map: ReadableMap, key: String): String? =
        if (map.hasKey(key) && !map.isNull(key)) map.getString(key) else null

    private fun readDouble(map: ReadableMap, key: String): Double? =
        if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null

    private fun readBoolean(map: ReadableMap, key: String): Boolean? =
        if (map.hasKey(key) && !map.isNull(key)) map.getBoolean(key) else null

    private fun readLong(map: ReadableMap, key: String): Long? =
        readDouble(map, key)?.takeIf { !it.isNaN() && !it.isInfinite() }?.toLong()

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

    private fun updateDurationFromMpv() {
        try {
            val nativeDuration = validDuration(MPVLib.getPropertyDouble("duration"))
            if (nativeDuration > 0) {
                durationSecs = nativeDuration
                syncMetadata()
            }
            val nativePosition = MPVLib.getPropertyDouble("time-pos")
            if (nativePosition != null && !nativePosition.isNaN() && nativePosition >= 0) {
                positionSecs = nativePosition
            }
            emitProgress(force = true)
        } catch (e: Exception) {
            Log.d(TAG, "updateDurationFromMpv ignored", e)
        }
    }

    private fun markLoading(autoPlay: Boolean, requestedGeneration: Long): Long {
        val generation = requestedGeneration
        currentLoadGeneration = generation
        loadingGeneration = generation
        pendingUnpauseGeneration = if (autoPlay) generation else -1L
        val now = System.currentTimeMillis()
        ignoreEndFileUntilMs = now + END_FILE_SUPPRESS_MS
        suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
        stopRequested = false
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

    private fun forceUnpause(generation: Long) {
        if (!isCurrentGeneration(generation) || stopRequested) {
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
        activeTrackIdentity = identity
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
        schedulePlaylistCompaction()
        return prepared
    }

    private fun completeNaturalEnd(
        pending: PendingNaturalEnd,
        promotedTrack: PreparedTrack?,
    ) {
        if (pendingNaturalEnd?.serial != pending.serial) return
        pendingNaturalEnd = null
        val autoAdvanced = promotedTrack != null
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
            pendingUnpauseGeneration = currentLoadGeneration
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

    @ReactMethod
    fun initialize(options: ReadableMap, promise: Promise) {
        if (isInitialized.get()) {
            promise.resolve(null)
            return
        }

        mainHandler.post {
            try {
                MpvServiceBridge.clearPlaybackSession()
                MPVLib.create(reactContext.applicationContext)
                MPVLib.setOptionString("ao", "audiotrack,opensles")
                MPVLib.setOptionString("vo", "null")
                MPVLib.setOptionString("vid", "no")
                MPVLib.setOptionString("cache", "yes")
                MPVLib.setOptionString("cache-secs", "2")
                MPVLib.setOptionString(
                    "demuxer-max-bytes",
                    ((readDouble(options, "maxCacheSize") ?: (32.0 * 1024 * 1024))
                        .toLong())
                        .coerceAtLeast(8L * 1024 * 1024)
                        .toString(),
                )
                MPVLib.setOptionString("demuxer-readahead-secs", "2")
                MPVLib.setOptionString("network-timeout", "15")
                MPVLib.setOptionString("msg-level", "all=warn")
                MPVLib.setOptionString("hwdec", "no")
                // Let mpv naturally advance appended prepared-next entries. JS
                // handles the final ended state when there is no prepared next.
                MPVLib.setOptionString("keep-open", "no")
                MPVLib.setOptionString("gapless-audio", "yes")

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

                MpvServiceBridge.onCommand = { command, position, mediaId ->
                    sendEvent(
                        ON_MPV_REMOTE_COMMAND,
                        Arguments.createMap().apply {
                            putString("command", command)
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

                isInitialized.set(true)
                promise.resolve(null)
            } catch (e: Throwable) {
                Log.e(TAG, "init failed", e)
                unregisterAndroidAutoConnectionDetector()
                try {
                    MPVLib.destroy()
                } catch (_: Throwable) {
                }
                MpvServiceBridge.onCommand = null
                MpvServiceBridge.clearPlaybackSession()
                isInitialized.set(false)
                promise.reject("E_MPV_INIT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        if (!isInitialized.getAndSet(false)) {
            MpvServiceBridge.onCommand = null
            MpvServiceBridge.clearPlaybackSession()
            promise.resolve(null)
            return
        }

        mainHandler.post {
            try {
                stopRequested = true
                pendingPlaylistCompaction = false
                pendingNaturalEnd = null
                clearPreparedTrack(removeFromPlaylist = false)
                activeTrackIdentity = null
                loadingTrackIdentity = null
                MpvServiceBridge.onCommand = null
                unregisterAndroidAutoConnectionDetector()
                try {
                    reactContext.stopService(
                        Intent(reactContext, MpvPlaybackService::class.java),
                    )
                } catch (_: Exception) {
                }
                MPVLib.removeObserver(this@MpvPlayerModule)
                MPVLib.command(arrayOf("stop"))
                MPVLib.destroy()
            } catch (e: Exception) {
                Log.e(TAG, "destroy failed", e)
            } finally {
                currentState = "idle"
                MpvServiceBridge.clearPlaybackSession()
                promise.resolve(null)
            }
        }
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

        mainHandler.post {
            try {
                val headers =
                    if (payload.hasKey("headers") && !payload.isNull("headers")) {
                        payload.getMap("headers")
                    } else {
                        null
                    }
                MPVLib.setOptionString("http-header-fields", buildHeaderString(headers))

                val trackUserAgent = readString(payload, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                (trackUserAgent ?: defaultUserAgent)
                    ?.let { MPVLib.setOptionString("user-agent", it) }

                durationSecs = validDuration(readDouble(payload, "duration"))
                val autoPlay = readBoolean(payload, "autoPlay") ?: true
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
                loadingTrackIdentity = TrackIdentity(
                    url = url,
                    mediaId = mediaId,
                    loadGeneration = requestedGeneration,
                    prepareToken = readLong(payload, "prepareToken") ?: 0L,
                    queueRevision = readLong(payload, "queueRevision") ?: 0L,
                )

                val generation = markLoading(autoPlay, requestedGeneration)
                if (autoPlay) {
                    startPlaybackService(foreground = true)
                }
                if (!autoPlay) {
                    MPVLib.setPropertyBoolean("pause", true)
                }
                emitState(if (autoPlay) "buffering" else "paused")
                syncMetadata()
                emitProgress(force = true)

                Log.d(TAG, "loadAndPlay[$generation]: $url")
                MPVLib.command(arrayOf("loadfile", url, "replace"))
                if (autoPlay) {
                    scheduleUnpauseRetries(generation)
                } else {
                    MPVLib.setPropertyBoolean("pause", true)
                    emitState("paused", force = true)
                }
                promise.resolve(null)
            } catch (e: Exception) {
                loadingTrackIdentity = null
                Log.e(TAG, "loadAndPlay failed", e)
                promise.reject("E_LOAD", e.message, e)
            }
        }
    }

    @ReactMethod
    fun prepareNext(payload: ReadableMap?, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }

        mainHandler.post {
            try {
                clearPreparedTrack(removeFromPlaylist = true)
                val nextPayload = payload
                val url = nextPayload?.let { readString(it, "url") }
                if (nextPayload == null || url.isNullOrBlank()) {
                    promise.resolve(null)
                    return@post
                }

                val headers =
                    if (nextPayload.hasKey("headers") && !nextPayload.isNull("headers")) {
                        nextPayload.getMap("headers")
                    } else {
                        null
                    }
                MPVLib.setOptionString("http-header-fields", buildHeaderString(headers))

                val trackUserAgent = readString(nextPayload, "userAgent")
                    ?.takeIf { it.isNotBlank() }
                (trackUserAgent ?: defaultUserAgent)
                    ?.let { MPVLib.setOptionString("user-agent", it) }

                preparedTrack = PreparedTrack(
                    url = url,
                    mediaId = readString(nextPayload, "mediaId")
                        ?.takeIf { it.isNotBlank() }
                        ?: throw IllegalArgumentException("missing mediaId"),
                    loadGeneration = readLong(nextPayload, "loadGeneration")
                        ?: throw IllegalArgumentException("missing loadGeneration"),
                    prepareToken = readLong(nextPayload, "prepareToken")
                        ?: throw IllegalArgumentException("missing prepareToken"),
                    queueRevision = readLong(nextPayload, "queueRevision")
                        ?: throw IllegalArgumentException("missing queueRevision"),
                    title = readString(nextPayload, "title") ?: "",
                    artist = readString(nextPayload, "artist") ?: "",
                    album = readString(nextPayload, "album") ?: "",
                    artwork = readString(nextPayload, "artwork"),
                    duration = validDuration(readDouble(nextPayload, "duration")),
                )
                val appendIndex = readPlaylistCount()
                MPVLib.command(arrayOf("loadfile", url, "append"))
                hasPlaylistPreparedTrack = true
                preparedPlaylistIndex = appendIndex
                Log.d(
                    TAG,
                    "prepareNext: mediaId=${preparedTrack?.mediaId} " +
                        "generation=${preparedTrack?.loadGeneration} " +
                        "token=${preparedTrack?.prepareToken} " +
                        "queueRevision=${preparedTrack?.queueRevision} index=$appendIndex",
                )
                promise.resolve(null)
            } catch (e: Exception) {
                Log.w(TAG, "prepareNext failed", e)
                clearPreparedTrack(removeFromPlaylist = false)
                promise.reject("E_PREPARE_NEXT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun updateMetadata(payload: ReadableMap, promise: Promise) {
        mainHandler.post {
            try {
                cachedTitle = readString(payload, "title") ?: cachedTitle
                cachedArtist = readString(payload, "artist") ?: cachedArtist
                cachedAlbum = readString(payload, "album") ?: cachedAlbum
                if (payload.hasKey("artwork")) {
                    cachedArtwork = readString(payload, "artwork")
                }
                val duration = validDuration(readDouble(payload, "duration"))
                if (duration > 0) {
                    durationSecs = duration
                }
                syncMetadata()
                emitProgress(force = true)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("E_MPV_METADATA", e.message, e)
            }
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            MPVLib.setPropertyBoolean("pause", true)
            emitState("paused")
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun resume(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            try {
                startPlaybackService(foreground = true)
                val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                if (idle || currentState == "ended") {
                    MPVLib.command(arrayOf("seek", "0", "absolute"))
                }
                val generation = currentLoadGeneration
                pendingUnpauseGeneration = generation
                scheduleUnpauseRetries(generation)
                emitState("playing")
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("E_RESUME", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            stopRequested = true
            pendingPlaylistCompaction = false
            pendingNaturalEnd = null
            clearPreparedTrack(removeFromPlaylist = true)
            activeTrackIdentity = null
            loadingTrackIdentity = null
            loadingGeneration = -1L
            pendingUnpauseGeneration = -1L
            ignoreEndFileUntilMs = System.currentTimeMillis() + END_FILE_SUPPRESS_MS
            MPVLib.command(arrayOf("stop"))
            positionSecs = 0.0
            cacheAheadSecs = 0.0
            emitProgress(force = true)
            emitState("idle")
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun seekTo(seconds: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            MPVLib.command(arrayOf("seek", seconds.toString(), "absolute"))
            positionSecs = seconds.coerceAtLeast(0.0)
            emitProgress(force = true)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun setVolume(volume: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            MPVLib.setPropertyInt("volume", (volume * 100).toInt().coerceIn(0, 100))
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun setRate(rate: Double, promise: Promise) {
        if (!isInitialized.get()) {
            promise.reject("E_NOT_INIT", "not init")
            return
        }
        mainHandler.post {
            MPVLib.setPropertyDouble("speed", rate)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getIsPlaying(promise: Promise) {
        mainHandler.post {
            try {
                val paused = MPVLib.getPropertyBoolean("pause") ?: true
                val idle = MPVLib.getPropertyBoolean("idle-active") ?: true
                promise.resolve(!paused && !idle)
            } catch (_: Exception) {
                promise.resolve(currentState == "playing")
            }
        }
    }

    @ReactMethod
    fun getPosition(promise: Promise) {
        mainHandler.post {
            try {
                promise.resolve(MPVLib.getPropertyDouble("time-pos") ?: positionSecs)
            } catch (_: Exception) {
                promise.resolve(positionSecs)
            }
        }
    }

    @ReactMethod
    fun getDuration(promise: Promise) {
        mainHandler.post {
            try {
                val nativeDuration = validDuration(MPVLib.getPropertyDouble("duration"))
                promise.resolve(if (nativeDuration > 0) nativeDuration else durationSecs)
            } catch (_: Exception) {
                promise.resolve(durationSecs)
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

    override fun eventProperty(property: String, value: Long) {
        runMpvCallbackOnMain {
            when (property) {
                "time-pos" -> {
                    positionSecs = value.toDouble()
                    emitProgress()
                }
                "duration" -> {
                    if (value > 0) {
                        durationSecs = value.toDouble()
                        syncMetadata()
                        emitProgress(force = true)
                    }
                }
                "demuxer-cache-duration" -> {
                    cacheAheadSecs = value.toDouble().coerceAtLeast(0.0)
                    emitProgress()
                }
            }
        }
    }

    override fun eventProperty(property: String, value: Boolean) {
        runMpvCallbackOnMain {
            when (property) {
                "pause" -> {
                    val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
                    if (value) {
                        if (!idle && currentState != "ended") emitState("paused")
                    } else if (!idle || loadingGeneration == currentLoadGeneration) {
                        emitState("playing")
                    }
                }
                "idle-active" -> {
                    if (value) {
                        val now = System.currentTimeMillis()
                        if (
                            now < suppressIdleUntilMs ||
                            loadingGeneration == currentLoadGeneration ||
                            currentState == "ended"
                        ) {
                            return@runMpvCallbackOnMain
                        }
                        emitState("idle")
                    } else if (currentState != "paused" && currentState != "ended") {
                        emitState("playing")
                    }
                }
                "paused-for-cache" -> {
                    if (value) {
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
        runMpvCallbackOnMain {
            when (property) {
                "time-pos" -> {
                    if (!value.isNaN() && value >= 0) {
                        positionSecs = value
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
        runMpvCallbackOnMain {
            if (property == "playback-error") {
                Log.e(TAG, "playback error: $value")
                sendEvent(
                    ON_MPV_ERROR,
                    Arguments.createMap().apply {
                        putString("message", value)
                        putString("code", "mpv-playback-error")
                    },
                )
                emitState("error")
            }
        }
    }

    override fun event(eventId: Int) {
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
                        pendingUnpauseGeneration == generation
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
                    updateDurationFromMpv()
                    explicitIdentity?.let { identity ->
                        activeTrackIdentity = identity
                        loadingTrackIdentity = null
                        emitActiveTrackChanged(identity, "loaded")
                    }
                    if (pendingUnpauseGeneration == generation) {
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
                    updateDurationFromMpv()
                    val generation = currentLoadGeneration
                    if (pendingUnpauseGeneration == generation) {
                        forceUnpause(generation)
                    }
                }
                MPVLib.MPV_EVENT_END_FILE -> {
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
                    pendingUnpauseGeneration = -1L
                    loadingGeneration = -1L
                    val endedIdentity = activeTrackIdentity
                    val pending = PendingNaturalEnd(
                        serial = ++naturalEndSerial,
                        endedIdentity = endedIdentity,
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
