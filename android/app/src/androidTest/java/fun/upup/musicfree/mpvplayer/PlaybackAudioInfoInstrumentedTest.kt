package `fun`.upup.musicfree.mpvplayer

import android.Manifest
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import dev.jdtech.mpv.MPVLib
import java.io.DataOutputStream
import java.io.File
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** Real JNI and module queries. Timed null output avoids claiming hardware/DAC verification. */
class PlaybackAudioInfoInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var module: MpvPlayerModule
    private val files = mutableListOf<File>()
    @Before fun create() {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        instrumentation.runOnMainSync { module = MpvPlayerModule(NativePlaybackTestContext(context) { _, _ -> }) }
    }
    @After fun release() {
        if (this::module.isInitialized) call { module.destroy(it) }
        files.forEach { it.delete() }
    }
    @Test fun unloadedQueryDoesNotInitializeOrPlayAndPausedQueryPreservesPosition() {
        assertNull(call { module.getAudioInfo(it) })
        val initialized = MpvPlayerModule::class.java.getDeclaredField("isInitialized").apply { isAccessible = true }
            .get(module) as java.util.concurrent.atomic.AtomicBoolean
        assertFalse(initialized.get())
        record("unloaded", null, JSONObject().put("initialized", initialized.get()))
        initialize()
        load(tone(22050, 1), "mono", 11)
        val info = awaitInfo("mono", 11)
        assertEquals(22050, info.getInt("sampleRate")); assertEquals(1, info.getInt("channelCount"))
        assertTrue(info.getString("codec")!!.contains("pcm", ignoreCase = true))
        val engine = MpvPlayerModule::class.java.getDeclaredField("mpvInstance").apply { isAccessible = true }.get(module) as MPVLib
        val before = engine.getPropertyDouble("time-pos")!!
        repeat(3) { assertNotNull(call { module.getAudioInfo(it) }) }
        assertEquals(true, engine.getPropertyBoolean("pause"))
        val after = engine.getPropertyDouble("time-pos")!!
        assertEquals(before, after, .001)
        record("paused", info, JSONObject().put("positionBefore", before).put("positionAfter", after).put("enginePaused", engine.getPropertyBoolean("pause")))
        assertEquals(setOf("mediaId", "loadGeneration", "codec", "sampleRate", "channelCount", "bitrate"), info.toHashMap().keys)
    }
    @Test fun replacementNeverLabelsTheOldDecoderAsTheNewGeneration() {
        initialize()
        load(tone(22050, 1), "first", 21)
        record("before-replacement", awaitInfo("first", 21))
        load(tone(48000, 2), "second", 22)
        val immediate = call { module.getAudioInfo(it) } as ReadableMap?
        record("during-replacement", immediate)
        if (immediate != null) {
            assertEquals("second", immediate.getString("mediaId")); assertEquals(22.0, immediate.getDouble("loadGeneration"), 0.0)
            assertEquals(48000, immediate.getInt("sampleRate")); assertEquals(2, immediate.getInt("channelCount"))
        }
        val info = awaitInfo("second", 22)
        assertEquals(48000, info.getInt("sampleRate")); assertEquals(2, info.getInt("channelCount"))
        record("after-replacement", info)
    }
    private fun record(phase: String, info: ReadableMap?, extra: JSONObject = JSONObject()) {
        extra.put("phase", phase).put("info", info?.let { JSONObject(it.toHashMap()) } ?: JSONObject.NULL)
        File(context.filesDir, "playback-audio-info.jsonl").appendText(extra.toString() + "\n")
    }
    private fun initialize() {
        call { module.initialize(JavaOnlyMap.of("mpvOptions", JavaOnlyMap.of("ao", "null")), it) }
    }
    private fun load(file: File, id: String, generation: Long) {
        call { module.loadAndPlay(JavaOnlyMap.of("url", file.absolutePath, "mediaId", id,
            "loadGeneration", generation.toDouble(), "prepareToken", 0.0, "queueRevision", 1.0,
            "autoPlay", false, "title", "Audio info fixture"), it) }
    }
    private fun awaitInfo(id: String, generation: Long): ReadableMap {
        val end = SystemClock.elapsedRealtime() + 10_000
        while (SystemClock.elapsedRealtime() < end) {
            val info = call { module.getAudioInfo(it) } as ReadableMap?
            if (info?.getString("mediaId") == id && info.getDouble("loadGeneration") == generation.toDouble()) return info
            SystemClock.sleep(50)
        }
        throw AssertionError("decoded info not available for $id/$generation")
    }
    private fun call(action: (Promise) -> Unit): Any? {
        val done = CountDownLatch(1); val result = AtomicReference<Any?>(); val failure = AtomicReference<String?>()
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { result.set(args?.getOrNull(0)); done.countDown() }
                "reject" -> { failure.set(args?.joinToString()); done.countDown() }
                else -> throw AssertionError(method.name)
            }
            null
        } as Promise
        action(promise); assertTrue("query finished", done.await(10, TimeUnit.SECONDS)); assertNull(failure.get())
        return result.get()
    }
    private fun tone(rate: Int, channels: Int): File {
        val file = File.createTempFile("decoded-info-", ".wav", context.cacheDir); files.add(file)
        val frames = rate * 10; val bytes = frames * channels * 2
        DataOutputStream(file.outputStream().buffered()).use { out ->
            fun intLE(value: Int) = out.writeInt(Integer.reverseBytes(value))
            fun shortLE(value: Int) = out.writeShort(java.lang.Short.reverseBytes(value.toShort()).toInt())
            out.writeBytes("RIFF"); intLE(36 + bytes); out.writeBytes("WAVEfmt "); intLE(16)
            shortLE(1); shortLE(channels); intLE(rate); intLE(rate * channels * 2); shortLE(channels * 2); shortLE(16)
            out.writeBytes("data"); intLE(bytes)
            repeat(frames * channels) { shortLE((it % 100 - 50) * 40) }
        }
        return file
    }
}
