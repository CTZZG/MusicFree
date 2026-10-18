package `fun`.upup.musicfree.mpvplayer

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import dev.jdtech.mpv.MPVLib
import java.io.DataOutputStream
import java.io.File
import java.lang.reflect.Proxy
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters

/**
 * Delay Android service delivery; module, native engine and media session stay real.
 * A real-time null audio sink isolates lifecycle assertions from the emulator's
 * AudioTrack scheduling. This class does not test audio output; the existing
 * engine-progress and slow-loading suites retain the default audio backend.
 */
// First exercise source-less initialization (a normal service start). This loads
// framework classes outside Android's foreground-start deadline on software VMs.
// Each case still destroys its service; late-start cases require it to be absent.
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class PlaybackServiceStartupTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val states = CopyOnWriteArrayList<String>()
    private var module: MpvPlayerModule? = null
    private lateinit var deferredContext: DeferredServiceContext
    private lateinit var engine: MPVLib
    private lateinit var tone: File

    private class DeferredServiceContext(
        private val actual: Context,
        events: java.util.function.BiConsumer<String, Any>,
    ) : NativePlaybackTestContext(actual, events) {
        private val starts = mutableListOf<Pair<Intent, Boolean>>()
        private var deferring = true

        override fun startService(service: Intent): ComponentName? {
            if (!deferring || service.component?.className != MpvPlaybackService::class.java.name) return super.startService(service)
            starts.add(Intent(service) to false)
            return service.component
        }

        override fun startForegroundService(service: Intent): ComponentName? {
            if (!deferring || service.component?.className != MpvPlaybackService::class.java.name) return super.startForegroundService(service)
            starts.add(Intent(service) to true)
            return service.component
        }

        fun deliverStarts() {
            check(starts.isNotEmpty()) { "no actual service request was intercepted" }
            val pending = starts.toList()
            starts.clear()
            deferring = false
            pending.forEach { (intent, foreground) ->
                if (foreground) actual.startForegroundService(intent) else actual.startService(intent)
            }
        }

        fun discardStarts() = starts.clear()
    }

    @Before fun playBeforeTheServiceExists() {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        tone = File.createTempFile("service-startup-", ".wav", context.cacheDir)
        writeTone()
        onMain {
            assertNull("the previous test released its service", MpvServiceBridge.service)
            deferredContext = DeferredServiceContext(context) { name, payload ->
                if (name == "onMpvStateChanged" && payload is ReadableMap) payload.getString("state")?.let(states::add)
            }
            module = MpvPlayerModule(deferredContext)
        }
        call { requireNotNull(module).initialize(options(), it) }
        onMain {
            engine = MpvPlayerModule::class.java.getDeclaredField("mpvInstance").apply { isAccessible = true }
                .get(requireNotNull(module)) as MPVLib
        }
        call { requireNotNull(module).loadAndPlay(JavaOnlyMap.of(
            "url", tone.absolutePath, "title", "Service startup fixture", "artist", "E2E",
            "duration", 90.0, "autoPlay", true, "mediaId", "service-startup", "loadGeneration", 1.0,
        ), it) }
        await("real engine playing before service creation") {
            onMain { engine.getPropertyString("path") == tone.absolutePath &&
                engine.getPropertyBoolean("pause") == false && (engine.getPropertyDouble("time-pos") ?: 0.0) >= 1.0 }
        }
        assertTrue("real module already emitted playing", states.contains("playing"))
        assertNull("service creation is still deferred", MpvServiceBridge.service)
        record("engine-before-service")
    }

    @After fun releasePlayback() {
        onMain {
            module?.invalidate()
            module = null
            context.stopService(Intent(context, MpvPlaybackService::class.java))
            MpvServiceBridge.playbackHold.claim()
        }
        await("service released") { MpvServiceBridge.service == null }
        if (::tone.isInitialized) tone.delete()
    }

    @Test fun lateServiceReceivesPlayingMetadataAndProgressWithoutAnotherStateEvent() {
        val playingEvents = states.count { it == "playing" }
        onMain { deferredContext.deliverStarts() }
        awaitSession(3)
        val session = onMain { controller() }
        // Binder metadata queries must not hold the app's main looper: that
        // would prevent the real module from delivering progress while we read.
        val metadata = session.metadata
        assertEquals("Service startup fixture", metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE))
        assertEquals("E2E", metadata?.getString(MediaMetadataCompat.METADATA_KEY_ARTIST))
        val readAt = SystemClock.elapsedRealtime()
        val rawBefore = requireNotNull(engine.getPropertyDouble("time-pos"))
        val reported = requireNotNull(session.playbackState).position / 1000.0
        val rawAfter = requireNotNull(engine.getPropertyDouble("time-pos"))
        val readMs = SystemClock.elapsedRealtime() - readAt
        android.util.Log.i("ServiceStartupRead", JSONObject().put("rawBefore", rawBefore)
            .put("sessionSeconds", reported).put("rawAfter", rawAfter).put("readMs", readMs).toString())
        assertTrue("session progress=$reported, engine=$rawAfter, readMs=$readMs", abs(reported - rawAfter) < 1.0)
        assertEquals("service attachment does not resend a JS play event", playingEvents, states.count { it == "playing" })
        record("late-service-playing")
    }

    @Test fun lateServiceKeepsPauseAndExternalHoldUntilExplicitPlay() {
        onMain { MpvServiceBridge.playbackHold.pauseByUser() }
        call { requireNotNull(module).pause(it) }
        val pausedAt = onMain { requireNotNull(engine.getPropertyDouble("time-pos")) }
        onMain { deferredContext.deliverStarts() }
        awaitSession(2)
        repeat(5) {
            onMain {
                assertTrue("service readiness cannot claim playback", MpvServiceBridge.playbackHold.blocksAutoPlay)
                assertEquals(true, engine.getPropertyBoolean("pause"))
                assertEquals(pausedAt, requireNotNull(engine.getPropertyDouble("time-pos")), 0.1)
                assertEquals(2, controller().playbackState?.state)
            }
            record("late-service-paused")
            Thread.sleep(1100)
        }
        call { requireNotNull(module).claimPlayback(it) }
        call { requireNotNull(module).resume(it) }
        awaitSession(3)
        await("explicit play advances the same engine") {
            onMain { (engine.getPropertyDouble("time-pos") ?: 0.0) > pausedAt + 0.25 }
        }
        onMain { assertFalse(MpvServiceBridge.playbackHold.blocksAutoPlay) }
        record("explicitly-resumed")
    }

    @Test fun recreatedServiceReceivesTheStillPlayingSession() {
        onMain { deferredContext.deliverStarts() }
        await("initial service created") { MpvServiceBridge.service?.mediaSessionTokenOrNull() != null }
        // Establish a synchronized first service even on the old product. The
        // regression below must fail at recreation, not at initial attachment.
        call { requireNotNull(module).pause(it) }
        awaitSession(2)
        call { requireNotNull(module).resume(it) }
        awaitSession(3)
        val playingEvents = states.count { it == "playing" }
        val previous = requireNotNull(MpvServiceBridge.service)
        onMain { context.stopService(Intent(context, MpvPlaybackService::class.java)) }
        await("old service destroyed") { MpvServiceBridge.service == null }
        val before = onMain { requireNotNull(engine.getPropertyDouble("time-pos")) }
        await("engine continues while service is absent") {
            onMain { (engine.getPropertyDouble("time-pos") ?: 0.0) > before + 0.25 }
        }
        onMain {
            context.startForegroundService(Intent(context, MpvPlaybackService::class.java).apply {
                action = MpvPlaybackService.ACTION_START_FOREGROUND
            })
        }
        awaitSession(3)
        assertNotSame(previous, MpvServiceBridge.service)
        assertEquals("recreation does not resend a JS play event", playingEvents, states.count { it == "playing" })
        onMain { assertEquals("Service startup fixture", controller().metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE)) }
        record("recreated-service-playing")
    }

    @Test fun initializationWithoutASourceDoesNotAdvertisePlayback() {
        onMain {
            requireNotNull(module).invalidate()
            deferredContext.discardStarts()
            module = MpvPlayerModule(deferredContext)
            states.clear()
        }
        call { requireNotNull(module).initialize(options(), it) }
        onMain {
            engine = MpvPlayerModule::class.java.getDeclaredField("mpvInstance").apply { isAccessible = true }
                .get(requireNotNull(module)) as MPVLib
        }
        Thread.sleep(1100) // Drain initial property notifications before testing service attachment.
        onMain { deferredContext.deliverStarts() }
        await("empty service created") { MpvServiceBridge.service?.mediaSessionTokenOrNull() != null }
        Thread.sleep(1100)
        onMain {
            assertTrue("no source must not become PLAYING or BUFFERING", controller().playbackState?.state in setOf(0, 1))
            assertEquals(true, engine.getPropertyBoolean("idle-active"))
            val notifications = context.getSystemService(NotificationManager::class.java)
            assertNull("initialization alone must not create a playback notification", notifications.activeNotifications.firstOrNull { it.id == 3001 })
        }
        record("initialized-without-source")
    }

    private fun controller() = MediaControllerCompat(context, requireNotNull(MpvServiceBridge.service?.mediaSessionTokenOrNull()))

    private fun options() = JavaOnlyMap.of(
        "progressIntervalMs", 250.0,
        "mpvOptions", JavaOnlyMap.of("ao", "null"),
    )

    private fun awaitSession(state: Int) = await("service state $state") {
        onMain { MpvServiceBridge.service?.mediaSessionTokenOrNull()?.let { MediaControllerCompat(context, it).playbackState?.state == state } == true }
    }

    private fun record(phase: String) = onMain {
        val row = JSONObject().put("phase", phase).put("elapsedMs", SystemClock.elapsedRealtime())
            .put("rawSeconds", engine.getPropertyDouble("time-pos")).put("paused", engine.getPropertyBoolean("pause"))
            .put("enginePath", engine.getPropertyString("path"))
            .put("servicePresent", MpvServiceBridge.service != null)
            .put("moduleStates", org.json.JSONArray(states)).put("externalHold", MpvServiceBridge.playbackHold.blocksAutoPlay)
            .put("sessionState", MpvServiceBridge.service?.mediaSessionTokenOrNull()?.let { MediaControllerCompat(context, it).playbackState?.state } ?: JSONObject.NULL)
        android.util.Log.i("E2EServiceStartup", row.toString())
    }

    private fun await(what: String, condition: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + 12000
        while (!condition()) {
            if (SystemClock.elapsedRealtime() >= until) {
                record("timeout-$what")
                throw AssertionError("$what timed out")
            }
            Thread.sleep(50)
        }
    }

    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }

    private fun call(action: (Promise) -> Unit) {
        val done = CountDownLatch(1)
        var error: String? = null
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> done.countDown()
                "reject" -> { error = args?.joinToString(); done.countDown() }
                else -> throw AssertionError(method.name)
            }
            null
        } as Promise
        action(promise)
        assertTrue("native operation completed", done.await(10, TimeUnit.SECONDS))
        assertNull("native operation succeeded: $error", error)
    }

    private fun writeTone() {
        val rate = 22050
        val samples = rate * 90
        DataOutputStream(tone.outputStream().buffered()).use { out ->
            fun intLE(value: Int) = out.writeInt(Integer.reverseBytes(value))
            fun shortLE(value: Int) = out.writeShort(java.lang.Short.reverseBytes(value.toShort()).toInt())
            out.writeBytes("RIFF"); intLE(36 + samples * 2); out.writeBytes("WAVEfmt "); intLE(16)
            shortLE(1); shortLE(1); intLE(rate); intLE(rate * 2); shortLE(2); shortLE(16)
            out.writeBytes("data"); intLE(samples * 2)
            repeat(samples) { shortLE((sin(2 * PI * 330 * it / rate) * 1200).toInt()) }
        }
    }
}
