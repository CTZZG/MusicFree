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
import android.support.v4.media.session.PlaybackStateCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import dev.jdtech.mpv.MPVLib
import java.io.DataOutputStream
import java.io.File
import java.lang.reflect.Proxy
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName

/** Real HTTP loading, module/JNI, notifications and focus. JS events are observed, not a React UI. */
class SlowQualityLoadingTest {
    @Rule @JvmField val testName = TestName()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val focusPackage = "fun.upup.musicfree.e2e.focus"
    private val states = CopyOnWriteArrayList<String>()
    private val commands = CopyOnWriteArrayList<String>()
    private val sessionStates = CopyOnWriteArrayList<Int>()
    private val sessionCallback = object : MediaControllerCompat.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
            state?.let { sessionStates.add(it.state) }
        }
    }
    private val requestStarted = CountDownLatch(1)
    private val releaseResponse = CountDownLatch(1)
    private var module: MpvPlayerModule? = null
    private var server: MockWebServer? = null
    private lateinit var engine: MPVLib
    private lateinit var tone: File
    private lateinit var controller: MediaControllerCompat
    private var target = 0.0

    @Before fun setUp() {
        assumeTrue("notification regression runs on Android 16", Build.VERSION.SDK_INT >= 36)
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        tone = File.createTempFile("slow-quality-", ".wav", context.cacheDir)
        writeTone()
        onMain {
            module = MpvPlayerModule(NativePlaybackTestContext(context) { name, payload ->
                if (payload is ReadableMap) {
                    if (name == "onMpvStateChanged") payload.getString("state")?.let(states::add)
                    if (name == "onMpvRemoteCommand") payload.getString("command")?.let(commands::add)
                }
            })
        }
        // Fixture headroom only: neither server nor mpv should time out during
        // the focus/pause windows. Production's 15-second setting is unchanged.
        call {
            requireNotNull(module).initialize(JavaOnlyMap.of(
                "progressIntervalMs", 250.0,
                "mpvOptions", JavaOnlyMap.of("network-timeout", "60"),
            ), it)
        }
        call { requireNotNull(module).loadAndPlay(payload(tone.absolutePath, 1.0), it) }
        await("service and real initial playback") {
            onMain {
                val service = MpvServiceBridge.service ?: return@onMain false
                val field = MpvPlayerModule::class.java.getDeclaredField("mpvInstance").apply { isAccessible = true }
                engine = field.get(requireNotNull(module)) as MPVLib
                controller = MediaControllerCompat(context, requireNotNull(service.mediaSessionTokenOrNull()))
                engine.getPropertyString("path") == tone.absolutePath &&
                    (engine.getPropertyDouble("time-pos") ?: 0.0) >= 1.0 &&
                    engine.getPropertyBoolean("pause") == false && controller.playbackState?.state == 3
            }
        }
        onMain { requireNotNull(MpvServiceBridge.service).onLiveUpdateLyricEnabledChanged(true) }
        Thread.sleep(1100) // Drain old file events/retries before observing replacement states.
        onMain {
            controller.registerCallback(sessionCallback, Handler(Looper.getMainLooper()))
            states.clear()
            commands.clear()
            sessionStates.clear()
        }
    }

    @After fun tearDown() {
        releaseResponse.countDown()
        onMain {
            if (::controller.isInitialized) controller.unregisterCallback(sessionCallback)
            module?.invalidate()
            module = null
            MpvServiceBridge.liveUpdateLyric.setEnabled(false)
            MpvServiceBridge.playbackHold.claim()
        }
        server?.shutdown()
        instrumentation.uiAutomation.executeShellCommand("am force-stop $focusPackage").use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).readBytes()
        }
        await("service released") { MpvServiceBridge.service == null }
        if (::tone.isInitialized) tone.delete()
    }

    @Test fun internalPauseWhileWaitingForTheFileKeepsBufferingAndThePauseAction() {
        startSlowReplacement()
        observeHeld("internal-loading", setOf(6), "暂停")
        assertTrue("JS must receive buffering", states.contains("buffering"))
        assertTrue("internal stop must not be reported to JS as paused: $states", !states.contains("paused"))
        releaseAndAwaitLoaded(paused = false)
        assertTrue("internal replacement must not publish any paused event: $states", !states.contains("paused"))
    }

    @Test fun theNotificationPauseDuringSlowLoadingSurvivesFileLoaded() {
        startSlowReplacement()
        // Send the actual notification PendingIntent, not an explicit pause command.
        // Detect a stale PAUSED state turning this button into PLAY instead of PAUSE.
        await("notification update") { notificationAction()?.title?.toString() in setOf("播放", "暂停") }
        Thread.sleep(1300)
        record("notification-before-click")
        onMain { requireNotNull(notificationAction()).actionIntent.send() }
        await("notification command handled") { commands.contains("pause") || commands.contains("play") }
        record("notification-command")
        assertTrue("notification must request pause, not play: $commands", commands.contains("pause"))
        assertTrue("notification must not also request play: $commands", !commands.contains("play"))
        await("explicit pause is visible") { controller.playbackState?.state == 2 }
        observeHeld("user-paused-loading", setOf(2), "播放")
        releaseAndAwaitLoaded(paused = true)
        claimAndResume()
    }

    @Test fun aTemporaryFocusLossDuringLoadingReportsPauseAndCanResumeAfterFocusReturns() {
        startSlowReplacement()
        startVideo()
        await("real transient audio focus loss") { commands.contains("interruptionBegan") }
        observeHeld("focus-paused-loading", setOf(2), "播放")
        await("real focus return reaches the JS bridge") { commands.contains("interruptionEnded") }
        assertTrue("focus hold released", onMain { !MpvServiceBridge.playbackHold.blocksAutoPlay })
        // No React runtime in this fixture: explicitly perform the native resume that
        // TrackPlayer's interruptionEnded path issues. Real-JS auto-resume has its own suite.
        call { requireNotNull(module).resume(it) }
        observeHeld("focus-resumed-loading", setOf(3, 6), "暂停")
        releaseAndAwaitLoaded(paused = false)
    }

    @Test fun anExplicitPauseDuringTheInterruptionWinsAfterFocusReturnsAndTheFileLoads() {
        startSlowReplacement()
        startVideo()
        await("real transient audio focus loss") { commands.contains("interruptionBegan") }
        onMain { controller.transportControls.pause() }
        await("explicit external pause") { commands.contains("pause") }
        await("real focus return") { commands.contains("interruptionEnded") }
        assertTrue("user pause still holds after focus return", onMain { MpvServiceBridge.playbackHold.blocksAutoPlay })
        observeHeld("user-paused-after-focus", setOf(2), "播放")
        releaseAndAwaitLoaded(paused = true)
        claimAndResume()
    }

    private fun startSlowReplacement() {
        val bytes = tone.readBytes()
        val controlled = MockWebServer()
        server = controlled
        controlled.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requestStarted.countDown()
                if (!releaseResponse.await(45, TimeUnit.SECONDS)) return MockResponse().setResponseCode(503)
                val range = request.getHeader("Range")
                val offset = range?.removePrefix("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                if (offset !in bytes.indices) return MockResponse().setResponseCode(416)
                return MockResponse().setHeader("Content-Type", "audio/wav").setHeader("Accept-Ranges", "bytes")
                    .apply {
                        if (range != null) setResponseCode(206).setHeader("Content-Range", "bytes $offset-${bytes.lastIndex}/${bytes.size}")
                    }.setBody(Buffer().write(bytes, offset, bytes.size - offset))
            }
        }
        controlled.start(InetAddress.getByName("127.0.0.1"), 0)
        val fallback = requireNotNull(engine.getPropertyDouble("time-pos"))
        val map = payload(controlled.url("/replacement.wav").toString(), 2.0)
        map.putDouble("preservePositionFallback", fallback)
        target = (call { requireNotNull(module).loadAndPlay(map, it) } as Number).toDouble()
        assertTrue("engine requested the real HTTP file", requestStarted.await(5, TimeUnit.SECONDS))
        assertEquals("response is still withheld", 1L, releaseResponse.count)
        assertEquals("new file has not completed loading", 2L, onMain { longField("loadingGeneration") })
    }

    private fun observeHeld(phase: String, allowedStates: Set<Int>, action: String) {
        // Let notification throttling settle, but retain all preceding JS state events.
        Thread.sleep(300)
        val rows = (0..12).map {
            val row = record(phase)
            Thread.sleep(100)
            row
        }
        assertTrue("HTTP response must remain blocked", releaseResponse.count == 1L)
        for (row in rows) {
            assertEquals("real engine must remain paused: $row", true, row.getBoolean("enginePaused"))
            assertEquals("new file must still be loading: $row", 2L, row.getLong("loadingGeneration"))
            assertTrue("wrong media state while waiting: $row", row.getInt("sessionState") in allowedStates)
            assertEquals("wrong notification action: $row", action, row.getString("action"))
        }
    }

    private fun record(phase: String): JSONObject {
        val row = onMain {
            JSONObject().apply {
                put("phase", phase)
                put("scenario", testName.methodName)
                put("elapsedMs", SystemClock.elapsedRealtime())
                put("enginePaused", engine.getPropertyBoolean("pause"))
                put("rawSeconds", engine.getPropertyDouble("time-pos") ?: JSONObject.NULL)
                put("restoreTarget", target)
                put("loadingGeneration", longField("loadingGeneration"))
                put("sessionState", controller.playbackState?.state ?: -1)
                put("action", notificationAction()?.title?.toString() ?: "missing")
                put("jsStates", JSONArray(states.toList()))
                put("commands", JSONArray(commands.toList()))
                put("sessionStates", JSONArray(sessionStates.toList()))
            }
        }
        File(context.filesDir, "quality-loading-state.jsonl").appendText("$row\n")
        android.util.Log.i("E2EQualityLoading", row.toString())
        return row
    }

    private fun releaseAndAwaitLoaded(paused: Boolean) {
        releaseResponse.countDown()
        await("new generation loaded and seek completed") {
            onMain {
                val field = MpvPlayerModule::class.java.getDeclaredField("activeTrackIdentity").apply { isAccessible = true }
                val identity = field.get(requireNotNull(module))
                val generation = identity?.javaClass?.getDeclaredField("loadGeneration")?.apply { isAccessible = true }?.get(identity) as? Number
                generation?.toLong() == 2L && engine.getPropertyBoolean("seeking") == false &&
                    engine.getPropertyBoolean("pause") == paused &&
                    controller.playbackState?.state == (if (paused) 2 else 3) &&
                    (engine.getPropertyDouble("time-pos") ?: -1.0) >= target - 0.25
            }
        }
        if (paused) {
            Thread.sleep(1200) // Includes all native automatic unpause retries.
            assertEquals(true, engine.getPropertyBoolean("pause"))
            assertEquals(target, requireNotNull(engine.getPropertyDouble("time-pos")), 0.25)
            assertEquals(2, controller.playbackState?.state)
        } else {
            await("replacement engine actually advances") {
                engine.getPropertyBoolean("pause") == false &&
                    (engine.getPropertyDouble("time-pos") ?: 0.0) > target + 0.25
            }
        }
        record(if (paused) "loaded-paused" else "loaded-playing")
    }

    private fun claimAndResume() {
        call { requireNotNull(module).claimPlayback(it) }
        call { requireNotNull(module).resume(it) }
        await("user play resumes the real engine") {
            engine.getPropertyBoolean("pause") == false && (engine.getPropertyDouble("time-pos") ?: 0.0) > target + 0.25 &&
                controller.playbackState?.state == 3 && notificationAction()?.title?.toString() == "暂停"
        }
        record("explicitly-resumed")
    }

    private fun startVideo() {
        // This native fixture has no foreground React Activity. Launch as the test
        // shell, so Android's background-activity policy cannot hide the focus test.
        val output = instrumentation.uiAutomation.executeShellCommand(
            "am start -W -n $focusPackage/.HoldFocusActivity --es mode transient --ei seconds 3",
        ).use { descriptor -> java.io.FileInputStream(descriptor.fileDescriptor).readBytes().toString(Charsets.UTF_8) }
        assertTrue("focus helper launched: $output", output.contains("Status: ok"))
    }

    private fun notificationAction(): Notification.Action? = notifications.activeNotifications
        .firstOrNull { it.id == 3001 }?.notification?.actions?.firstOrNull { it.title?.toString() in setOf("播放", "暂停") }

    private fun longField(name: String): Long = (MpvPlayerModule::class.java.getDeclaredField(name)
        .apply { isAccessible = true }.get(requireNotNull(module)) as Number).toLong()

    private fun payload(url: String, generation: Double) = JavaOnlyMap.of(
        "url", url, "mediaId", "slow-quality", "loadGeneration", generation,
        "title", "Slow quality fixture", "artist", "E2E", "duration", 30.0, "autoPlay", true,
    )

    private fun await(what: String, condition: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + 12000
        while (!condition()) {
            if (SystemClock.elapsedRealtime() >= until) throw AssertionError("$what timed out")
            Thread.sleep(50)
        }
    }

    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }

    private fun call(action: (Promise) -> Unit): Any? {
        val done = CountDownLatch(1)
        var result: Any? = null
        var failure: String? = null
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { result = args?.firstOrNull(); done.countDown() }
                "reject" -> { failure = args?.joinToString(); done.countDown() }
                else -> throw AssertionError(method.name)
            }; null
        } as Promise
        action(promise)
        assertTrue("native operation completed", done.await(10, TimeUnit.SECONDS))
        failure?.let { throw AssertionError(it) }
        return result
    }

    private fun writeTone() {
        val rate = 22050
        val size = rate * 30 * 2
        DataOutputStream(tone.outputStream().buffered()).use { output ->
            fun intLE(value: Int) = output.writeInt(Integer.reverseBytes(value))
            fun shortLE(value: Int) = output.writeShort(java.lang.Short.reverseBytes(value.toShort()).toInt())
            output.writeBytes("RIFF"); intLE(36 + size); output.writeBytes("WAVEfmt ")
            intLE(16); shortLE(1); shortLE(1); intLE(rate); intLE(rate * 2); shortLE(2); shortLE(16)
            output.writeBytes("data"); intLE(size)
            repeat(rate * 30) { n -> shortLE((sin(2 * PI * 440 * n / rate) * 500).toInt()) }
        }
    }
}
