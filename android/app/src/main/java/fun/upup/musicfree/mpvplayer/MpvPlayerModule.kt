package `fun`.upup.musicfree.mpvplayer

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import dev.jdtech.mpv.MPVLib
import java.util.concurrent.atomic.AtomicBoolean

/**
 * mpv 单曲播放引擎（仅 Android）。
 *
 * 管线：loadfile replace → pause=false（立即，不等待 FILE_LOADED）
 * 跟 dev-mpv1 一样的简单模式，已验证可靠。
 *
 * END_FILE 抑制：用时间窗口（lastLoadTime + 1s），避免 replace 导致的旧文件 END_FILE 误触发。
 */
class MpvPlayerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    MPVLib.EventObserver {

    private val isInitialized = AtomicBoolean(false)
    private var positionSecs = 0.0
    private var durationSecs = 0.0
    private var currentState = "idle"

    /** 最后一次 loadAndPlay 的时间戳，用于抑制紧接着的 END_FILE */
    private var lastLoadTimeMs = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    private var cachedTitle = ""
    private var cachedArtist = ""
    private var cachedAlbum = ""
    private var cachedArtwork: String? = null

    companion object {
        private const val TAG = "MpvPlayerModule"
        private const val ON_MPV_STATE_CHANGED = "onMpvStateChanged"
        private const val ON_MPV_PROGRESS = "onMpvProgress"
        private const val ON_MPV_ENDED = "onMpvEnded"
        private const val ON_MPV_ERROR = "onMpvError"
        private const val ON_MPV_REMOTE_COMMAND = "onMpvRemoteCommand"
        private const val END_FILE_SUPPRESS_MS = 800L // loadAndPlay 后 800ms 内抑制 END_FILE
    }

    override fun getName() = "MpvPlayer"

    // ═══════════════════════════════════════════
    // event helpers
    // ═══════════════════════════════════════════

    private fun sendEvent(name: String, params: WritableMap?) {
        reactContext.getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(name, params ?: Arguments.createMap())
    }

    private fun emitState(state: String) {
        if (currentState == state) return
        currentState = state
        val p = Arguments.createMap().apply { putString("state", state) }
        sendEvent(ON_MPV_STATE_CHANGED, p)
        MpvServiceBridge.service?.onPlaybackStateChanged(state)
    }

    private fun emitProgress() {
        val p = Arguments.createMap().apply {
            putDouble("position", positionSecs)
            putDouble("duration", durationSecs)
        }
        sendEvent(ON_MPV_PROGRESS, p)
        MpvServiceBridge.service?.onProgressChanged(positionSecs, durationSecs)
    }

    private fun syncMetadata() {
        MpvServiceBridge.service?.onMetadataChanged(
            cachedTitle, cachedArtist, cachedAlbum, cachedArtwork, durationSecs
        )
    }

    // ═══════════════════════════════════════════
    // initialize / destroy
    // ═══════════════════════════════════════════

    @ReactMethod
    fun initialize(options: ReadableMap, promise: Promise) {
        if (isInitialized.get()) { promise.resolve(null); return }
        mainHandler.post {
            try {
                MPVLib.create(reactContext.applicationContext)
                MPVLib.setOptionString("ao", "audiotrack,opensles")
                MPVLib.setOptionString("vo", "null"); MPVLib.setOptionString("vid", "no")
                MPVLib.setOptionString("cache", "yes"); MPVLib.setOptionString("cache-secs", "2")
                MPVLib.setOptionString("demuxer-max-bytes", (32 * 1024 * 1024).toString())
                MPVLib.setOptionString("demuxer-readahead-secs", "2")
                MPVLib.setOptionString("network-timeout", "15")
                MPVLib.setOptionString("msg-level", "all=warn"); MPVLib.setOptionString("hwdec", "no")
                MPVLib.setOptionString("keep-open", "always")

                options.getString("userAgent")?.let { if (it.isNotBlank()) MPVLib.setOptionString("user-agent", it) }
                options.getMap("mpvOptions")?.let { opts ->
                    val it = opts.keySetIterator()
                    while (it.hasNextKey()) { val k = it.nextKey(); val v = opts.getString(k); if (!k.isNullOrBlank() && v != null) MPVLib.setOptionString(k, v) }
                }

                MPVLib.init()
                MPVLib.addObserver(this@MpvPlayerModule)

                MPVLib.observeProperty("pause", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("time-pos", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("duration", MPVLib.MPV_FORMAT_DOUBLE)
                MPVLib.observeProperty("idle-active", MPVLib.MPV_FORMAT_FLAG)
                MPVLib.observeProperty("paused-for-cache", MPVLib.MPV_FORMAT_FLAG)

                try { reactContext.startService(Intent(reactContext, MpvPlaybackService::class.java)) } catch (e: Exception) { Log.w(TAG, "startService", e) }

                MpvServiceBridge.onCommand = { cmd, pos ->
                    val p = Arguments.createMap().apply { putString("command", cmd); if (pos != null) putDouble("position", pos) }
                    sendEvent(ON_MPV_REMOTE_COMMAND, p)
                }

                isInitialized.set(true)
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "init", e)
                try { MPVLib.destroy() } catch (_: Exception) {}
                isInitialized.set(false)
                promise.reject("E_MPV_INIT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun destroy(promise: Promise) {
        if (!isInitialized.getAndSet(false)) { promise.resolve(null); return }
        mainHandler.post {
            try {
                MpvServiceBridge.onCommand = null
                try { reactContext.stopService(Intent(reactContext, MpvPlaybackService::class.java)) } catch (_: Exception) {}
                MPVLib.removeObserver(this@MpvPlayerModule)
                MPVLib.command(arrayOf("stop"))
                MPVLib.destroy()
            } catch (e: Exception) { Log.e(TAG, "destroy", e) } finally { currentState = "idle"; promise.resolve(null) }
        }
    }

    // ═══════════════════════════════════════════
    // playback
    // ═══════════════════════════════════════════

    @ReactMethod
    fun loadAndPlay(payload: ReadableMap, promise: Promise) {
        val url = payload.getString("url")
        if (url.isNullOrBlank()) { promise.reject("E_NO_URL", "no URL"); return }
        mainHandler.post {
            try {
                payload.getMap("headers")?.let { h -> val s = buildHeaderString(h); if (s.isNotEmpty()) MPVLib.setOptionString("http-header-fields", s) }
                payload.getString("userAgent")?.let { if (it.isNotBlank()) MPVLib.setOptionString("user-agent", it) }

                val dur = payload.getDouble("duration")
                durationSecs = if (!dur.isNaN() && dur > 0) dur else 0.0
                positionSecs = 0.0
                cachedTitle = payload.getString("title") ?: ""
                cachedArtist = payload.getString("artist") ?: ""
                cachedAlbum = payload.getString("album") ?: ""
                cachedArtwork = payload.getString("artwork")

                // 记录时间戳，800ms 内 END_FILE 将被抑制（old file 被 replace 导致）
                lastLoadTimeMs = System.currentTimeMillis()

                Log.d(TAG, "loadAndPlay: $url")
                MPVLib.command(arrayOf("loadfile", url, "replace"))
                MPVLib.setPropertyBoolean("pause", false)

                emitState("playing")
                syncMetadata()
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "loadAndPlay", e)
                promise.reject("E_LOAD", e.message, e)
            }
        }
    }

    @ReactMethod
    fun updateMetadata(payload: ReadableMap, promise: Promise) {
        cachedTitle = payload.getString("title") ?: cachedTitle
        cachedArtist = payload.getString("artist") ?: cachedArtist
        cachedAlbum = payload.getString("album") ?: cachedAlbum
        payload.getString("artwork")?.let { cachedArtwork = it }
        val dur = payload.getDouble("duration")
        if (!dur.isNaN() && dur > 0) durationSecs = dur
        syncMetadata()
        promise.resolve(null)
    }

    @ReactMethod
    fun pause(promise: Promise) {
        if (!isInitialized.get()) { promise.reject("E_NOT_INIT", "not init"); return }
        mainHandler.post { MPVLib.setPropertyBoolean("pause", true); promise.resolve(null) }
    }

    @ReactMethod
    fun resume(promise: Promise) {
        if (!isInitialized.get()) { promise.reject("E_NOT_INIT", "not init"); return }
        mainHandler.post {
            val idle = MPVLib.getPropertyBoolean("idle-active") ?: false
            if (idle) { MPVLib.command(arrayOf("seek", "0", "absolute")); lastLoadTimeMs = System.currentTimeMillis() }
            MPVLib.setPropertyBoolean("pause", false)
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        if (!isInitialized.get()) { promise.reject("E_NOT_INIT", "not init"); return }
        mainHandler.post { MPVLib.command(arrayOf("stop")); emitState("idle"); promise.resolve(null) }
    }

    @ReactMethod
    fun seekTo(seconds: Double, promise: Promise) {
        if (!isInitialized.get()) { promise.reject("E_NOT_INIT", "not init"); return }
        mainHandler.post { MPVLib.command(arrayOf("seek", seconds.toString(), "absolute")); promise.resolve(null) }
    }

    @ReactMethod fun setVolume(volume: Double, promise: Promise) { if (!isInitialized.get()) { promise.reject("E_NOT_INIT", ""); return }; mainHandler.post { MPVLib.setPropertyInt("volume", (volume * 100).toInt().coerceIn(0, 100)); promise.resolve(null) } }
    @ReactMethod fun setRate(rate: Double, promise: Promise) { if (!isInitialized.get()) { promise.reject("E_NOT_INIT", ""); return }; mainHandler.post { MPVLib.setPropertyDouble("speed", rate); promise.resolve(null) } }

    @ReactMethod fun getIsPlaying(promise: Promise) { mainHandler.post { try { val p = MPVLib.getPropertyBoolean("pause") ?: true; val i = MPVLib.getPropertyBoolean("idle-active") ?: true; promise.resolve(!p && !i) } catch (_: Exception) { promise.resolve(false) } } }
    @ReactMethod fun getPosition(promise: Promise) { mainHandler.post { try { promise.resolve(MPVLib.getPropertyDouble("time-pos") ?: positionSecs) } catch (_: Exception) { promise.resolve(positionSecs) } } }
    @ReactMethod fun getDuration(promise: Promise) { mainHandler.post { try { promise.resolve(MPVLib.getPropertyDouble("duration") ?: durationSecs) } catch (_: Exception) { promise.resolve(durationSecs) } } }

    private fun buildHeaderString(headers: ReadableMap): String {
        val sb = StringBuilder(); val it = headers.keySetIterator()
        while (it.hasNextKey()) { val k = it.nextKey(); val v = headers.getString(k); if (!k.isNullOrBlank() && v != null) sb.append("$k: $v\r\n") }
        return sb.toString()
    }

    // ═══════════════════════════════════════════
    // MPVLib.EventObserver
    // ═══════════════════════════════════════════

    override fun eventProperty(property: String) {}
    override fun eventProperty(property: String, value: Long) {}

    override fun eventProperty(property: String, value: Boolean) {
        when (property) {
            "pause" -> emitState(if (value) "paused" else "playing")
            "idle-active" -> { if (value) emitState("idle") }
            "paused-for-cache" -> emitState(if (value) "buffering" else "playing")
        }
    }

    override fun eventProperty(property: String, value: Double) {
        when (property) {
            "time-pos" -> { positionSecs = value; emitProgress() }
            "duration" -> { if (value > 0) { durationSecs = value; emitProgress() } }
        }
    }

    override fun eventProperty(property: String, value: String) {
        if (property == "playback-error") {
            Log.e(TAG, "playback error: $value")
            sendEvent(ON_MPV_ERROR, Arguments.createMap().apply { putString("message", value); putString("code", "mpv-playback-error") })
            emitState("error")
        }
    }

    override fun event(eventId: Int) {
        when (eventId) {
            MPVLib.MPV_EVENT_END_FILE -> {
                // 时间窗口抑制：loadAndPlay/replace 后 800ms 内的 END_FILE 是旧文件的，跳过
                if (System.currentTimeMillis() - lastLoadTimeMs < END_FILE_SUPPRESS_MS) {
                    Log.d(TAG, "END_FILE suppressed (within ${END_FILE_SUPPRESS_MS}ms of load)")
                    return
                }
                sendEvent(ON_MPV_ENDED, Arguments.createMap().apply { putString("reason", "end") })
                emitState("ended")
            }
            MPVLib.MPV_EVENT_SHUTDOWN -> {
                Log.e(TAG, "MPV_EVENT_SHUTDOWN")
                val err = MPVLib.getPropertyString("error") ?: MPVLib.getPropertyString("playback-error") ?: "mpv shutdown"
                sendEvent(ON_MPV_ERROR, Arguments.createMap().apply { putString("message", err); putString("code", "mpv-shutdown") })
                emitState("error")
            }
        }
    }
}
