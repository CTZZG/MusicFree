package `fun`.upup.musicfree.mpvplayer

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.session.MediaControllerCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import dev.jdtech.mpv.MPVLib
import java.io.DataOutputStream
import java.io.File
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/** Real module -> libmpv -> playback service. No JS runtime, network or estimated raw reads. */
class LiveUpdateEngineProgressTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private var module: MpvPlayerModule? = null
    private lateinit var engine: MPVLib
    private lateinit var tone: File
    private lateinit var controller: MediaControllerCompat
    private val service: MpvPlaybackService get() = requireNotNull(MpvServiceBridge.service)

    @Before
    fun startRealPlayback() {
        assumeTrue("Live Update needs Android 16", Build.VERSION.SDK_INT >= 36)
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        tone = File.createTempFile("engine-progress-", ".wav", context.cacheDir)
        writeTone(tone)
        instrumentation.runOnMainSync { module = MpvPlayerModule(NativePlaybackTestContext(context)) }
        call { requireNotNull(module).initialize(JavaOnlyMap.of("progressIntervalMs", 250.0), it) }
        await("playback service") { MpvServiceBridge.service != null }
        instrumentation.runOnMainSync {
            service.onLiveUpdateLyricEnabledChanged(true)
            controller = MediaControllerCompat(context, requireNotNull(service.mediaSessionTokenOrNull()))
            // Read this module's actual JNI handle. Keep access test-only: no production debug endpoint.
            val field = MpvPlayerModule::class.java.getDeclaredField("mpvInstance")
            field.isAccessible = true
            engine = field.get(requireNotNull(module)) as MPVLib
        }
        call {
            requireNotNull(module).loadAndPlay(JavaOnlyMap.of(
                "url", tone.absolutePath, "title", "Raw engine progress fixture", "artist", "E2E",
                "duration", 90.0, "autoPlay", true, "mediaId", "raw-progress", "loadGeneration", 1.0,
            ), it)
        }
        awaitPlaying()
    }

    @After
    fun releaseRealPlayback() {
        // Includes callbacks, retries, JNI observer, audio focus and test tone on failed assertions too.
        instrumentation.runOnMainSync {
            module?.invalidate()
            module = null
            MpvServiceBridge.liveUpdateLyric.setEnabled(false)
            MpvServiceBridge.playbackHold.claim()
        }
        await("playback service released") { MpvServiceBridge.service == null }
        if (::tone.isInitialized) tone.delete()
    }

    @Test
    fun queuedSourceReplacementPreservesTheStoppedPositionAndPause() {
        val fallback = requireNotNull(engine.getPropertyDouble("time-pos"))
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        var lastOld: Double? = null
        var readFailure: Throwable? = null
        Handler(Looper.getMainLooper()).post {
            entered.countDown()
            try { release.await(10, TimeUnit.SECONDS) } finally { finished.countDown() }
        }
        val releaser = Thread {
            try {
                check(entered.await(5, TimeUnit.SECONDS))
                Thread.sleep(600)
                lastOld = engine.getPropertyDouble("time-pos")
            } catch (failure: Throwable) {
                readFailure = failure
            } finally {
                release.countDown()
            }
        }
        try {
            assertTrue("main looper is held before queuing replacement", entered.await(5, TimeUnit.SECONDS))
            releaser.start()
            val restored = call {
                requireNotNull(module).loadAndPlay(JavaOnlyMap.of(
                    "url", tone.absolutePath, "mediaId", "raw-progress", "loadGeneration", 2.0,
                    "title", "Raw engine progress fixture", "artist", "E2E", "duration", 90.0,
                    "autoPlay", false, "preservePositionFallback", fallback,
                ), it)
            } as? Number ?: throw AssertionError("native restore target missing")
            releaser.join(5000)
            readFailure?.let { throw AssertionError("old engine reading failed", it) }
            val stopped = restored.toDouble()
            assertTrue("old engine advanced while replacement queued", requireNotNull(lastOld) >= fallback + 0.25)
            assertTrue("restore target includes queued progress", stopped >= requireNotNull(lastOld) - 0.001)
            await("replacement seek completed while paused") {
                onMain {
                    val activeField = MpvPlayerModule::class.java.getDeclaredField("activeTrackIdentity").apply { isAccessible = true }
                    val active = activeField.get(requireNotNull(module))
                    val generation = active?.javaClass?.getDeclaredField("loadGeneration")?.apply { isAccessible = true }?.get(active) as? Number
                    generation?.toLong() == 2L &&
                        engine.getPropertyBoolean("pause") == true &&
                        engine.getPropertyBoolean("seeking") == false &&
                        engine.getPropertyDouble("time-pos")?.let { kotlin.math.abs(it - stopped) <= 0.25 } == true
                }
            }
            Thread.sleep(1100)
            assertEquals(true, engine.getPropertyBoolean("pause"))
            assertEquals(stopped, requireNotNull(engine.getPropertyDouble("time-pos")), 0.25)
            call { requireNotNull(module).resume(it) }
            awaitPlaying()
        } finally {
            release.countDown()
            releaser.join(5000)
            assertTrue("main released before cleanup", finished.await(5, TimeUnit.SECONDS))
        }
    }

    @Test
    fun transitionReadsDoNotWaitForMainLooper() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            entered.countDown()
            try { release.await(10, TimeUnit.SECONDS) } finally { finished.countDown() }
        }
        try {
            assertTrue("main looper is held", entered.await(5, TimeUnit.SECONDS))
            assertTrue("instrumentation reads from a worker", Looper.myLooper() != Looper.getMainLooper())
            val started = SystemClock.elapsedRealtime()
            val sample = SourceTransitionReader.read(
                clock = SystemClock::elapsedRealtime,
                path = { engine.getPropertyString("path") },
                position = { engine.getPropertyDouble("time-pos") },
                idle = { engine.getPropertyBoolean("idle-active") },
                buffering = { engine.getPropertyBoolean("paused-for-cache") },
            )
            assertEquals("main still held when real JNI reads return", 1L, finished.count)
            assertEquals(tone.absolutePath, sample.path)
            assertTrue("real nonzero engine reading", requireNotNull(sample.rawSeconds) >= 1.0)
            assertEquals(false, sample.idle)
            assertEquals(false, sample.buffering)
            android.util.Log.i("E2ETransitionThread", "worker JNI reads completed in ${SystemClock.elapsedRealtime() - started}ms while main held")
        } finally {
            release.countDown()
            assertTrue("main looper released before cleanup", finished.await(5, TimeUnit.SECONDS))
        }
    }

    @Test
    fun liveUpdateProgressTracksTheRealEngine() {
        EngineProgressProbe.assertPlaying(observe("playing"), tone.absolutePath)
    }

    @Test
    fun pauseAndResumeAgreeWithTheRealEngine() {
        call { requireNotNull(module).pause(it) }
        await("engine and session paused") {
            onMain { engine.getPropertyBoolean("pause") == true && controller.playbackState?.state == 2 }
        }
        // Allow the last queued native progress callback to settle before checking a fixed position.
        Thread.sleep(500)
        EngineProgressProbe.assertPaused(observe("paused"), tone.absolutePath)
        call { requireNotNull(module).resume(it) }
        awaitPlaying()
        EngineProgressProbe.assertPlaying(observe("resumed"), tone.absolutePath)
    }

    @Test
    fun aProjectedClockCannotHideAStoppedEngine() {
        call { requireNotNull(module).pause(it) }
        await("engine and session paused") {
            onMain { engine.getPropertyBoolean("pause") == true && controller.playbackState?.state == 2 }
        }
        Thread.sleep(500)
        // Inject a stale service projection, not a real CPU suspension. The real engine stays paused.
        // Detach only the module's observer so later pause/progress callbacks cannot repair that fault.
        onMain {
            engine.removeObserver(requireNotNull(module))
            val raw = requireNotNull(engine.getPropertyDouble("time-pos"))
            service.onProgressChanged(raw, 90.0, raw)
            service.onPlaybackStateChanged("playing")
        }
        val samples = observe("negative-stale-projection")
        assertTrue("control must show the Live Update ticker projecting progress", samples.last().sessionMs - samples.first().sessionMs >= 2500)
        val rejection = assertThrows(AssertionError::class.java) {
            EngineProgressProbe.assertPlaying(samples, tone.absolutePath)
        }
        assertTrue("must reject real stalled progress: ${rejection.message}", rejection.message!!.startsWith("RAW_STALLED:"))
        // Prove cleanup and playback still work after the injected fault; reattach the real observer.
        onMain { engine.addObserver(requireNotNull(module)) }
        call { requireNotNull(module).resume(it) }
        awaitPlaying()
        EngineProgressProbe.assertPlaying(observe("recovered-after-control"), tone.absolutePath)
    }

    private fun observe(phase: String): List<EngineProgressSample> = (0..4).map { index ->
        if (index > 0) Thread.sleep(1100)
        val sample = onMain {
            val state = requireNotNull(controller.playbackState)
            val notification = requireNotNull(notifications.activeNotifications.firstOrNull { it.id == 3001 }?.notification)
            assertEquals("Live Update is actually active", "android.app.Notification\$ProgressStyle", notification.extras.getString(Notification.EXTRA_TEMPLATE))
            EngineProgressSample(
                SystemClock.elapsedRealtime(), engine.getPropertyDouble("time-pos"),
                engine.getPropertyBoolean("pause"), engine.getPropertyBoolean("idle-active"),
                engine.getPropertyBoolean("paused-for-cache"), engine.getPropertyString("path"),
                state.position, state.state,
            )
        }
        val row = JSONObject().apply {
            put("phase", phase)
            put("elapsedMs", sample.elapsedMs)
            put("rawSeconds", sample.rawSeconds ?: JSONObject.NULL)
            put("paused", sample.paused ?: JSONObject.NULL)
            put("idle", sample.idle ?: JSONObject.NULL)
            put("buffering", sample.buffering ?: JSONObject.NULL)
            put("sessionMs", sample.sessionMs)
            put("sessionState", sample.sessionState)
            // The temporary file is local and has no user/plugin data.
            put("sameTrack", sample.path == tone.absolutePath)
        }
        File(context.filesDir, "engine-progress-samples.jsonl").appendText("$row\n")
        sample
    }

    private fun awaitPlaying() {
        await("real engine loaded and playing") {
            onMain {
                engine.getPropertyString("path") == tone.absolutePath &&
                    (engine.getPropertyDouble("time-pos") ?: 0.0) >= 1.0 &&
                    engine.getPropertyBoolean("pause") == false &&
                    engine.getPropertyBoolean("paused-for-cache") == false &&
                    controller.playbackState?.state == 3
            }
        }
        Thread.sleep(1100) // First file events and scheduled load retries have settled.
    }

    private fun await(what: String, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 15000
        while (!condition()) {
            if (SystemClock.elapsedRealtime() >= deadline) throw AssertionError("$what timed out")
            Thread.sleep(50)
        }
    }

    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }

    private fun call(action: (Promise) -> Unit): Any? {
        val completed = CountDownLatch(1)
        var failure: String? = null
        var result: Any? = null
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { result = args?.firstOrNull(); completed.countDown() }
                "reject" -> { failure = args?.joinToString(); completed.countDown() }
                else -> throw AssertionError("Unexpected Promise call: ${method.name}")
            }
            null
        } as Promise
        action(promise)
        assertTrue("native operation completed", completed.await(15, TimeUnit.SECONDS))
        if (failure != null) throw AssertionError("native operation failed: $failure")
        return result
    }

    private fun writeTone(file: File) {
        val rate = 22050
        val bytes = rate * 90 * 2
        DataOutputStream(file.outputStream().buffered()).use { output ->
            fun intLE(value: Int) = output.writeInt(Integer.reverseBytes(value))
            fun shortLE(value: Int) = output.writeShort(java.lang.Short.reverseBytes(value.toShort()).toInt())
            output.writeBytes("RIFF"); intLE(36 + bytes); output.writeBytes("WAVEfmt ")
            intLE(16); shortLE(1); shortLE(1); intLE(rate); intLE(rate * 2); shortLE(2); shortLE(16)
            output.writeBytes("data"); intLE(bytes)
            repeat(rate * 90) { n -> shortLE((sin(2 * PI * 440 * n / rate) * 500).toInt()) }
        }
    }
}
