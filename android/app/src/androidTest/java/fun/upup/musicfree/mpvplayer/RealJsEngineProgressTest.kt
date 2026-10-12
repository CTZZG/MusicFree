package `fun`.upup.musicfree.mpvplayer

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import dev.jdtech.mpv.MPVLib
import `fun`.upup.musicfree.MainActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** UI -> real JS/TrackPlayer/plugin -> the ReactHost-owned MPV module. No direct load/resume calls. */
class RealJsEngineProgressTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val automation = instrumentation.uiAutomation
    private val focusPackage = "fun.upup.musicfree.e2e.focus"
    private var activity: Activity? = null
    private var host: ReactHost? = null
    private lateinit var module: MpvPlayerModule
    private lateinit var engine: MPVLib
    private lateinit var controller: MediaControllerCompat
    private lateinit var ref: String
    private lateinit var configFile: File
    private var previousConfig: ByteArray? = null
    private val completed = mutableSetOf<String>()
    private val samplesFile get() = File(context.filesDir, "js-flow-engine-samples.jsonl")
    private val mq get() = audioUrl("tone-c.mp3", "192k")
    private val hq get() = audioUrl("tone-c.mp3", "320k")

    @Before fun launchActualJsApp() {
        check(Build.VERSION.SDK_INT >= 36) { "API36 is required, do not silently skip" }
        ref = InstrumentationRegistry.getArguments().getString("jsFlowRef") ?: error("Missing jsFlowRef")
        check(Regex("[0-9a-f]{40}").matches(ref)) { "Pin the fixture source SHA" }
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        samplesFile.delete()
        configFile = File(context.filesDir, "kvstore/App.config.json")
        previousConfig = configFile.takeIf { it.exists() }?.readBytes()
        seedConfig()
        activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        await("actual JS home", 120000) { findNode { label(it) == "资料库" } != null }
        dismissUpdate()
        onMain { host = (context.applicationContext as ReactApplication).reactHost }
        await("ReactHost-owned native module", 30000) {
            onMain {
                // RN's class overload requires @ReactModule; this legacy module is registered by name.
                val actual = host?.currentReactContext?.getNativeModule("MpvPlayer") as? MpvPlayerModule
                val field = MpvPlayerModule::class.java.getDeclaredField("mpvInstance").apply { isAccessible = true }
                val handle = actual?.let { field.get(it) as? MPVLib }
                if (actual != null && handle != null) { module = actual; engine = handle; true } else false
            }
        }
        onMain {
            controller = MediaControllerCompat(context, requireNotNull(MpvServiceBridge.service?.mediaSessionTokenOrNull()))
        }
        openLink("musicfree://install/" + Uri.encode("https://raw.githubusercontent.com/CTZZG/MusicFree/$ref/e2e/plugins/e2e-source-js-flow.js"))
        clickText("确认安装")
        await("plugin confirmation dismissed", 15000) { findNode { label(it) == "确认安装" } == null }
        await("fixture installed through the real plugin manager", 30000) {
            File(context.getExternalFilesDir(null), "plugins").listFiles()?.any {
                it.extension == "js" && it.readText().contains("E2E JS Flow")
            } == true
        }
        search("seed")
        clickSearchSong("JS Flow B")
        awaitEngine(audioUrl("tone-b.mp3", "192k"), false, "JS Flow B")
    }

    @After fun releaseActualApp() {
        shell("am force-stop $focusPackage")
        val released = CountDownLatch(if (host == null) 0 else 1)
        val destroyed = AtomicBoolean(host == null)
        onMain {
            activity?.finish()
            host?.destroy("real-JS engine test complete", null) { success -> destroyed.set(success); released.countDown() }
        }
        assertTrue("ReactHost destroy completed", released.await(15, TimeUnit.SECONDS))
        assertTrue("ReactHost destroy succeeded", destroyed.get())
        await("native service released with ReactHost", 15000) { MpvServiceBridge.service == null }
        onMain { MpvServiceBridge.liveUpdateLyric.setEnabled(false); MpvServiceBridge.playbackHold.claim() }
        if (::configFile.isInitialized) {
            previousConfig?.let { configFile.writeBytes(it) } ?: configFile.delete()
        }
    }

    @Test fun realJsFlowsPreserveEngineAndPauseIntent() {
        if (InstrumentationRegistry.getArguments().getString("jsFlowFreezeControl") == "true") {
            Thread.sleep(2000) // Finish initial JS/native autoplay compensation before injecting a fault.
            onMain { engine.removeObserver(module); engine.setPropertyBoolean("pause", true) }
            await("control truly pauses the ReactHost engine", 5000) { onMain { engine.getPropertyBoolean("pause") == true } }
            Thread.sleep(500)
            onMain {
                val service = requireNotNull(MpvServiceBridge.service)
                val raw = requireNotNull(engine.getPropertyDouble("time-pos"))
                service.onProgressChanged(raw, 180.0, raw)
                service.onPlaybackStateChanged("playing")
            }
            // Intentionally fails RAW_STALLED; the shell validates that failure and five real samples.
        }
        observe("baseline", audioUrl("tone-b.mp3", "192k"), false)
        // The initial queue contains only B, so lookahead cannot quietly warm C beforehand.
        search("queue")
        clickSearchSong("JS Flow B")
        await("queue replaced through search UI", 15000) { MpvServiceBridge.getQueueSnapshot().size == 3 }
        awaitEngine(audioUrl("tone-b.mp3", "192k"), false, "JS Flow B")
        Thread.sleep(1200)
        val source = awaitSource("c", "192k", 0)
        check(System.currentTimeMillis() - source.getLong("wallMs") < 3500) { "C was prefetched too early to prove slow skip" }
        onMain { controller.transportControls.skipToNext() }
        awaitEngine(audioUrl("tone-b.mp3", "192k"), true, "JS Flow B")
        observe("slow-skip-wait", audioUrl("tone-b.mp3", "192k"), true)
        awaitEngine(mq, false, "JS Flow C")
        observe("slow-skip-playing", mq, false)

        val rollbackAnchor = onMain { requireNotNull(engine.getPropertyDouble("time-pos")) }
        val timeoutStarted = SystemClock.elapsedRealtime()
        onMain { controller.transportControls.skipToNext() }
        awaitEngine(mq, true, "JS Flow C")
        observe("timeout-wait", mq, true)
        awaitEngine(mq, false, "JS Flow C", anchor = rollbackAnchor, deadline = timeoutStarted + 25000)
        observe("timeout-rollback", mq, false, anchor = rollbackAnchor)

        // Real quality UI, slow plugin, and another app holding transient focus.
        openPlayer()
        val requestAt = selectQuality("高清音质 320K")
        awaitSource("c", "320k", requestAt)
        startVideo("quality-auto-resume")
        awaitEngine(mq, true, "JS Flow C")
        val anchor = requireNotNull(observe("quality-interrupted-old", mq, true, held = true).rawSeconds)
        awaitEngine(hq, true, "JS Flow C", anchor = anchor)
        observe("quality-interrupted-new", hq, true, held = true, anchor = anchor)
        awaitVideoReleased("quality-auto-resume")
        awaitEngine(hq, false, "JS Flow C")
        observe("quality-focus-resumed", hq, false)
        awaitText { label(it).contains("音质：HQ") }

        // Repeat while paused explicitly during the interruption: focus return must not play.
        val secondRequestAt = selectQuality("标准音质 192K")
        awaitSource("c", "192k", secondRequestAt)
        startVideo("quality-user-pause")
        awaitEngine(hq, true, "JS Flow C")
        onMain { controller.transportControls.pause() }
        val pausedAnchor = requireNotNull(observe("user-pause-old", hq, true, held = true).rawSeconds)
        awaitEngine(mq, true, "JS Flow C", anchor = pausedAnchor)
        observe("user-pause-new", mq, true, held = true, anchor = pausedAnchor)
        awaitVideoReleased("quality-user-pause")
        observe("user-pause-after-focus", mq, true)
        onMain { controller.transportControls.play() }
        awaitEngine(mq, false, "JS Flow C")
        observe("explicit-play", mq, false)
        awaitText { label(it).contains("音质：MQ") }

        // The old source keeps playing throughout this twelve-second request.
        val playingRequestAt = selectQuality("高清音质 320K")
        awaitSource("c", "320k", playingRequestAt)
        observe("quality-playing-old", mq, false)
        val oldStop = awaitSourceReplacement(mq, hq)
        // Do not wait for the new position to catch up to the anchor: a rewind
        // must fail on its first ready sample, even if it would catch up later.
        awaitEngine(hq, false, "JS Flow C")
        observe("quality-playing-new", hq, false, anchor = oldStop)
        awaitText { label(it).contains("音质：HQ") }
        JsFlowProbePolicy.assertComplete(completed)
    }

    private fun observe(phase: String, path: String, paused: Boolean, held: Boolean = false, anchor: Double? = null): EngineProgressSample {
        var nextSampleAt = SystemClock.elapsedRealtime()
        val samples = List(5) {
            val remaining = nextSampleAt - SystemClock.elapsedRealtime()
            if (remaining > 0) Thread.sleep(remaining)
            val sample = onMain {
                // Never acquire a new module or another engine to repair a missing read.
                assertTrue("same ReactHost module", host?.currentReactContext?.getNativeModule("MpvPlayer") === module)
                val state = requireNotNull(controller.playbackState)
                val notifications = context.getSystemService(NotificationManager::class.java)
                val notification = requireNotNull(notifications.activeNotifications.firstOrNull { it.id == 3001 }?.notification)
                assertEquals("real JS enables Live Update", "android.app.Notification\$ProgressStyle", notification.extras.getString(Notification.EXTRA_TEMPLATE))
                EngineProgressSample(SystemClock.elapsedRealtime(), engine.getPropertyDouble("time-pos"),
                    engine.getPropertyBoolean("pause"), engine.getPropertyBoolean("idle-active"),
                    engine.getPropertyBoolean("paused-for-cache"), engine.getPropertyString("path"), state.position, state.state)
            }
            nextSampleAt = sample.elapsedMs + 1100
            val owner = if (held) JsFlowProbePolicy.focusOwner(shell("dumpsys audio")) else null
            val foreground = automation.rootInActiveWindow?.packageName?.toString()
            val sameTitle = onMain { controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) ==
                (if (phase == "baseline" || phase == "slow-skip-wait") "JS Flow B" else "JS Flow C") }
            val row = JSONObject().apply {
                put("phase", phase); put("elapsedMs", sample.elapsedMs)
                put("rawSeconds", sample.rawSeconds ?: JSONObject.NULL)
                put("paused", sample.paused ?: JSONObject.NULL); put("idle", sample.idle ?: JSONObject.NULL)
                put("buffering", sample.buffering ?: JSONObject.NULL); put("sessionMs", sample.sessionMs)
                put("sessionState", sample.sessionState); put("sameTrack", sample.path == path)
                put("sameTitle", sameTitle)
                put("focusOwner", owner ?: JSONObject.NULL)
                put("foregroundPackage", foreground ?: JSONObject.NULL)
                put("resumeAnchor", anchor ?: JSONObject.NULL)
            }
            samplesFile.appendText("$row\n")
            assertTrue("$phase: matching media title", sameTitle)
            if (held) assertEquals("$phase: video owns focus on every sample", focusPackage, owner)
            if (held) assertEquals("$phase: MusicFree UI stays foreground during the quality operation", context.packageName, foreground)
            sample
        }
        if (paused) EngineProgressProbe.assertPaused(samples, path) else EngineProgressProbe.assertPlaying(samples, path)
        if (anchor != null && phase in setOf("quality-interrupted-new", "user-pause-new", "quality-playing-new")) {
            JsFlowProbePolicy.assertResumeAnchor(anchor, requireNotNull(samples.first().rawSeconds))
            JsFlowProbePolicy.assertSourceContinuity(anchor, requireNotNull(samples.first().rawSeconds))
        }
        completed.add(phase)
        return samples.last()
    }

    private fun awaitSourceReplacement(oldPath: String, newPath: String): Double {
        var lastOldPosition: Double? = null
        await("quality source replacement", 20000) {
            onMain {
                val path = engine.getPropertyString("path")
                val raw = engine.getPropertyDouble("time-pos")
                // Unload can briefly reset time-pos to zero while path still
                // names the old file. This scenario is already past 3 seconds.
                if (path == oldPath && raw != null && raw.isFinite() && raw >= 3.0 &&
                    engine.getPropertyBoolean("idle-active") == false &&
                    engine.getPropertyBoolean("paused-for-cache") == false) {
                    lastOldPosition = raw
                }
                path == newPath
            }
        }
        return requireNotNull(lastOldPosition) { "SOURCE_REWIND: missing old-source stop position" }
    }

    private fun awaitEngine(path: String, paused: Boolean, title: String, anchor: Double? = null,
                            deadline: Long = SystemClock.elapsedRealtime() + 30000) {
        var lastRead = "no engine read"
        try {
            await("engine $title ${if (paused) "paused" else "playing"} $path", deadline = deadline) {
                onMain {
                    val raw = engine.getPropertyDouble("time-pos")
                    val actualPath = engine.getPropertyString("path")
                    val actualPause = engine.getPropertyBoolean("pause")
                    val idle = engine.getPropertyBoolean("idle-active")
                    val buffering = engine.getPropertyBoolean("paused-for-cache")
                    val state = controller.playbackState?.state
                    val actualTitle = controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
                    lastRead = "path=$actualPath raw=$raw pause=$actualPause idle=$idle buffering=$buffering " +
                        "sessionState=$state title=$actualTitle expectedAnchor=$anchor"
                    actualPath == path && raw != null && raw.isFinite() &&
                        (if (anchor != null) kotlin.math.abs(raw - anchor) <= 2.0 else paused || raw >= 1.0) &&
                        actualPause == paused && idle == false && buffering == false &&
                        state == (if (paused) 2 else 3) && actualTitle == title
                }
            }
        } catch (error: AssertionError) {
            android.util.Log.e("E2EJSFlow", "awaitEngine failed: $lastRead")
            throw error
        }
        if (anchor != null) onMain { JsFlowProbePolicy.assertResumeAnchor(anchor, requireNotNull(engine.getPropertyDouble("time-pos"))) }
        Thread.sleep(300) // Let final progress/seek callbacks settle, without changing the player.
    }

    private fun seedConfig() {
        configFile.parentFile!!.mkdirs()
        val data = previousConfig?.let { JSONObject(String(it, Charsets.UTF_8)) }
            ?: JSONObject().put("version", 1).put("entries", JSONObject())
        val entries = data.getJSONObject("entries")
        entries.put("\$schema", JSONObject().put("t", "s").put("v", "3"))
        entries.put("\$migratedFromMMKV", JSONObject().put("t", "s").put("v", "E2E JS flow"))
        // AppConfig.setConfig stores JSON.stringify(value) as a string, even
        // for booleans. Raw key-value booleans are not AppConfig values.
        val settings = mapOf(
            "lyric.showLiveUpdateLyric" to true,
            "basic.tryChangeSourceWhenPlayFail" to false,
            "basic.defaultPlayQuality" to "192k",
            "basic.clickMusicInSearch" to "playMusicAndReplace",
        )
        for ((key, value) in settings) {
            val encoded = if (value is String) JSONObject.quote(value) else value.toString()
            entries.put(key, JSONObject().put("t", "s").put("v", encoded))
        }
        configFile.writeText(data.toString())
    }

    private fun audioUrl(file: String, quality: String) = "https://raw.githubusercontent.com/CTZZG/MusicFree/$ref/e2e/fixtures/$file?jsFlowQuality=$quality"
    // MusicItem labels a row as "title, artist". The floating bar also exposes
    // its title text; clicking that text would open the player instead.
    private fun clickSearchSong(title: String) = clickText("$title, E2E Artist")
    private fun search(mode: String) {
        openLink("musicfree://search?keyword=" + Uri.encode("js-flow $ref $mode"))
        // B is also visible in the old seed result. Wait for a queue-only row
        // before clicking it, so route delivery cannot select the old result.
        val marker = if (mode == "queue") "JS Flow Hang" else "JS Flow B"
        awaitText { label(it) == marker }
    }
    private fun openLink(url: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    private fun openPlayer() { clickText("歌曲: JS Flow C 歌手: E2E Artist"); awaitText { label(it).startsWith("音质：") } }
    private fun selectQuality(name: String): Long {
        click { label(it).startsWith("音质：") }
        awaitText { label(it).contains(name) }
        val started = System.currentTimeMillis()
        click { label(it).contains(name) }
        return started
    }
    private fun startVideo(tag: String) {
        context.startActivity(Intent().setClassName(focusPackage, "$focusPackage.HoldFocusActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("mode", "transient").putExtra("seconds", 25).putExtra("tag", tag))
        // Focus is requested in onCreate, before the helper's window reaches the foreground.
        // Wait for that window too, otherwise the old MusicFree root can satisfy the next wait
        // just before the helper becomes visible and suspends the fixture's ordinary JS timer.
        await("video foreground and acquired transient focus", 5000) {
            automation.rootInActiveWindow?.packageName?.toString() == focusPackage &&
                JsFlowProbePolicy.focusOwner(shell("dumpsys audio")) == focusPackage
        }
        // Plugin setTimeout is a foreground JS fixture, not a background-timer test.
        // Showing MusicFree must not reclaim the other app's still-held audio focus.
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        await("MusicFree foreground with external focus still held", 5000) {
            automation.rootInActiveWindow?.packageName?.toString() == context.packageName &&
                JsFlowProbePolicy.focusOwner(shell("dumpsys audio")) == focusPackage
        }
    }
    private fun awaitVideoReleased(tag: String) {
        await("video released focus $tag", 30000) { shell("logcat -d -s E2EFocus").contains("abandoned focus tag=$tag") }
        await("video no longer owns focus", 5000) { JsFlowProbePolicy.focusOwner(shell("dumpsys audio")) != focusPackage }
    }
    private fun awaitSource(id: String, quality: String, since: Long): JSONObject {
        var found: JSONObject? = null
        await("real plugin begins $id/$quality", 15000) {
            found = shell("logcat -d -s ReactNativeJS").lineSequence().filter { it.contains("E2E_JS_FLOW ") }
                .mapNotNull { runCatching { JSONObject(it.substringAfter("E2E_JS_FLOW ")) }.getOrNull() }
                .lastOrNull { it.optString("event") == "begin" && it.optString("id") == id &&
                    it.optString("quality") == quality && it.optLong("wallMs") >= since }
            found != null
        }
        return requireNotNull(found)
    }
    private fun dismissUpdate() {
        val until = SystemClock.elapsedRealtime() + 8000
        while (SystemClock.elapsedRealtime() < until) {
            if (findNode { label(it).contains("发现新版本") } != null) {
                clickText("跳过此版本"); clickText("取消"); return
            }
            Thread.sleep(200)
        }
    }
    private fun label(node: AccessibilityNodeInfo) = node.contentDescription?.toString() ?: node.text?.toString() ?: ""
    private fun findNode(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        val root = automation.rootInActiveWindow ?: return null
        val pending = java.util.ArrayDeque<AccessibilityNodeInfo>().apply { add(root) }
        while (pending.isNotEmpty()) {
            val node = pending.removeFirst()
            if (node.isVisibleToUser && predicate(node)) return node
            for (i in 0 until node.childCount) node.getChild(i)?.let { pending.add(it) }
        }
        return null
    }
    private fun awaitText(predicate: (AccessibilityNodeInfo) -> Boolean) { await("UI element", 45000) { findNode(predicate) != null } }
    private fun clickText(text: String) = click { label(it) == text }
    private fun click(predicate: (AccessibilityNodeInfo) -> Boolean) {
        awaitText(predicate)
        val node = requireNotNull(findNode(predicate))
        var clickable: AccessibilityNodeInfo? = node
        while (clickable != null && !clickable.isClickable) clickable = clickable.parent
        if (clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return
        // Bounds come from the selected UI node, never from fixed screen percentages.
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        val now = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(now, now, action, bounds.exactCenterX(), bounds.exactCenterY(), 0).apply { source = InputDevice.SOURCE_TOUCHSCREEN }
            try { assertTrue("inject selected UI tap", automation.injectInputEvent(event, true)) } finally { event.recycle() }
        }
    }
    private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command)).bufferedReader().use { it.readText() }
    private fun await(what: String, timeout: Long = 15000, deadline: Long = SystemClock.elapsedRealtime() + timeout, condition: () -> Boolean) {
        while (!condition()) {
            if (SystemClock.elapsedRealtime() >= deadline) {
                val labels = mutableListOf<String>()
                findNode { labels.add(label(it)); false }
                android.util.Log.e("E2EJSFlow", "$what timed out; visible=${labels.filter { it.isNotBlank() }.distinct().take(40)}")
                throw AssertionError("$what timed out")
            }
            Thread.sleep(100)
        }
    }
    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }
}
