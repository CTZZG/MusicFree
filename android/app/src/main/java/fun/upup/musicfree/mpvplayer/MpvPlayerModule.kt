package `fun`.upup.musicfree.mpvplayer

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import dev.jdtech.mpv.MPVLib
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
    MPVLib.EventObserver {

    private val isInitialized = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())

    private data class PreparedTrack(
        val url: String,
        val title: String,
        val artist: String,
        val album: String,
        val artwork: String?,
        val duration: Double,
    )

    private var positionSecs = 0.0
    private var durationSecs = 0.0
    private var cacheAheadSecs = 0.0
    private var currentState = "idle"

    private var currentLoadGeneration = 0L
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

    companion object {
        private const val TAG = "MpvPlayerModule"
        private const val ON_MPV_STATE_CHANGED = "onMpvStateChanged"
        private const val ON_MPV_PROGRESS = "onMpvProgress"
        private const val ON_MPV_ENDED = "onMpvEnded"
        private const val ON_MPV_ERROR = "onMpvError"
        private const val ON_MPV_REMOTE_COMMAND = "onMpvRemoteCommand"
        private const val END_FILE_SUPPRESS_MS = 1200L
        private val PLAYLIST_COMPACT_DELAYS_MS = longArrayOf(0L, 120L, 500L)
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

    private fun readString(map: ReadableMap, key: String): String? =
        if (map.hasKey(key) && !map.isNull(key)) map.getString(key) else null

    private fun readDouble(map: ReadableMap, key: String): Double? =
        if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null

    private fun readBoolean(map: ReadableMap, key: String): Boolean? =
        if (map.hasKey(key) && !map.isNull(key)) map.getBoolean(key) else null

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

    private fun markLoading(autoPlay: Boolean): Long {
        val generation = ++currentLoadGeneration
        loadingGeneration = generation
        pendingUnpauseGeneration = if (autoPlay) generation else -1L
        val now = System.currentTimeMillis()
        ignoreEndFileUntilMs = now + END_FILE_SUPPRESS_MS
        suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
        stopRequested = false
        return generation
    }

    private fun isCurrentGeneration(generation: Long): Boolean =
        generation == currentLoadGeneration

    private fun forceUnpause(generation: Long) {
        if (!isCurrentGeneration(generation) || stopRequested) {
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

    private fun promotePreparedTrack(): Boolean {
        val prepared = preparedTrack ?: return false
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
        syncMetadata()
        emitProgress(force = true)
        schedulePlaylistCompaction()
        return true
    }

    @ReactMethod
    fun initialize(options: ReadableMap, promise: Promise) {
        if (isInitialized.get()) {
            promise.resolve(null)
            return
        }

        mainHandler.post {
            try {
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

                try {
                    reactContext.startService(
                        Intent(reactContext, MpvPlaybackService::class.java),
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "startService failed", e)
                }

                MpvServiceBridge.onCommand = { command, position ->
                    sendEvent(
                        ON_MPV_REMOTE_COMMAND,
                        Arguments.createMap().apply {
                            putString("command", command)
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
            } catch (e: Exception) {
                Log.e(TAG, "init failed", e)
                try {
                    MPVLib.destroy()
                } catch (_: Exception) {
                }
                isInitialized.set(false)
                promise.reject("E_MPV_INIT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        if (!isInitialized.getAndSet(false)) {
            promise.resolve(null)
            return
        }

        mainHandler.post {
            try {
                stopRequested = true
                pendingPlaylistCompaction = false
                clearPreparedTrack(removeFromPlaylist = false)
                MpvServiceBridge.onCommand = null
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
                promise.resolve(null)
            }
        }
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
                clearPreparedTrack(removeFromPlaylist = false)

                val generation = markLoading(autoPlay)
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
            clearPreparedTrack(removeFromPlaylist = true)
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

    override fun eventProperty(property: String, value: Boolean) {
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
                        return
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

    override fun eventProperty(property: String, value: Double) {
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

    override fun eventProperty(property: String, value: String) {
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

    override fun event(eventId: Int) {
        when (eventId) {
            MPVLib.MPV_EVENT_START_FILE -> {
                val generation = currentLoadGeneration
                loadingGeneration = generation
                if (pendingUnpauseGeneration == generation) {
                    emitState("buffering")
                    scheduleUnpauseRetries(generation)
                } else {
                    MPVLib.setPropertyBoolean("pause", true)
                    emitState("paused")
                }
            }
            MPVLib.MPV_EVENT_FILE_LOADED -> {
                val generation = currentLoadGeneration
                if (loadingGeneration == generation) {
                    loadingGeneration = -1L
                }
                updateDurationFromMpv()
                if (pendingUnpauseGeneration == generation) {
                    forceUnpause(generation)
                } else {
                    MPVLib.setPropertyBoolean("pause", true)
                    emitState("paused")
                }
            }
            MPVLib.MPV_EVENT_PLAYBACK_RESTART -> {
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
                    loadingGeneration == currentLoadGeneration
                ) {
                    Log.d(TAG, "END_FILE suppressed")
                    return
                }
                pendingUnpauseGeneration = -1L
                loadingGeneration = -1L
                val autoAdvanced = promotePreparedTrack()
                if (!autoAdvanced && durationSecs > 0) {
                    positionSecs = durationSecs
                    emitProgress(force = true)
                }
                sendEvent(
                    ON_MPV_ENDED,
                    Arguments.createMap().apply {
                        putString("reason", "end")
                        putBoolean("autoAdvanced", autoAdvanced)
                    },
                )
                if (autoAdvanced) {
                    pendingUnpauseGeneration = currentLoadGeneration
                    suppressIdleUntilMs = now + END_FILE_SUPPRESS_MS
                    scheduleUnpauseRetries(currentLoadGeneration)
                    emitState("buffering")
                } else {
                    emitState("ended")
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
