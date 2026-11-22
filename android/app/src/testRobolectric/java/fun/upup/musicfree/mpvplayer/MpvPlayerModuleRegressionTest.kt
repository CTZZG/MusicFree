package `fun`.upup.musicfree.mpvplayer

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Looper
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import dev.jdtech.mpv.MPVLib
import java.lang.reflect.Proxy
import java.time.Duration
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Drives real public module methods, guarded observers and Android main-looper tasks. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE, application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class MpvPlayerModuleRegressionTest {
    private lateinit var engine: Engine
    private lateinit var module: MpvPlayerModule
    private val events = mutableListOf<Pair<String, Map<String, Any?>>>()

    private class Result {
        var settled = false
        var code: String? = null
        var value: Any? = null
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { settled = true; value = args?.firstOrNull() }
                "reject" -> { settled = true; code = args?.firstOrNull() as? String }
            }
            null
        } as Promise
    }

    private class Engine : MpvEngine {
        val properties = mutableMapOf<String, Any?>("pause" to true, "speed" to 1.0, "idle-active" to true)
        val playlist = linkedMapOf<Long, String>()
        val commands = mutableListOf<List<String>>()
        lateinit var observer: MPVLib.EventObserver
        var nextId = 1L
        var failStop = false
        var failSeek = false
        var destroyed = false
        override fun create(context: Context) { destroyed = false; properties["speed"] = 1.0 }
        override fun init() = Unit
        override fun destroy() { destroyed = true }
        override fun eventProtocolVersion() = 2
        override fun command(command: Array<String>) {
            commands.add(command.toList())
            if (command[0] == "stop" && failStop) error("mpv command failed -9")
            if (command[0] == "seek") {
                check(!failSeek && properties["idle-active"] != true) { "mpv command failed -9" }
                properties["time-pos"] = command[1].toDouble()
            }
            if (command[0] == "stop") { select(null); properties["idle-active"] = true }
        }
        override fun loadFile(command: Array<String>): Long {
            if (command[2] == "replace") { playlist.clear(); select(null); properties["idle-active"] = true }
            val id = nextId++
            playlist[id] = command[1]
            return id
        }
        fun select(id: Long?) {
            properties.keys.filter { it.startsWith("playlist/") }.toList().forEach { properties.remove(it) }
            properties["playlist-count"] = playlist.size
            val ids = playlist.keys.toList()
            ids.forEachIndexed { index, entry ->
                properties["playlist/$index/id"] = entry.toString()
                properties["playlist/$index/playing"] = entry == id
            }
            properties["playlist-playing-pos"] = ids.indexOf(id)
            properties["playlist-pos"] = ids.indexOf(id)
            properties["path"] = playlist[id]
            if (id != null) { properties["idle-active"] = false; properties["eof-reached"] = false }
        }
        override fun setOptionString(name: String, value: String): Int { properties[name] = value; return 0 }
        override fun getPropertyInt(name: String) = properties[name] as? Int
        override fun getPropertyDouble(name: String) = (properties[name] as? Number)?.toDouble()
        override fun getPropertyBoolean(name: String) = properties[name] as? Boolean
        override fun getPropertyString(name: String) = properties[name] as? String
        override fun setPropertyInt(name: String, value: Int) { properties[name] = value }
        override fun setPropertyDouble(name: String, value: Double) { properties[name] = value }
        override fun setPropertyBoolean(name: String, value: Boolean) { properties[name] = value }
        override fun setPropertyString(name: String, value: String) { properties[name] = value }
        override fun observeProperty(name: String, format: Int) = Unit
        override fun addObserver(observer: MPVLib.EventObserver) { this.observer = observer }
        override fun removeObserver(observer: MPVLib.EventObserver) = Unit
    }

    private fun map(vararg pairs: Any?) = JavaOnlyMap.of(*pairs)
    private fun call(action: (Promise) -> Unit): Result = Result().also { action(it.promise); idle(); assertTrue("promise unresolved", it.settled) }
    private fun idle(ms: Long = 0L) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
    private inline fun <reified T> field(name: String): T = MpvPlayerModule::class.java.getDeclaredField(name).let { it.isAccessible = true; it.get(module) as T }
    private fun callback() = field<ConnectivityManager.NetworkCallback>("networkCallback")
    private fun network(id: Long) = Network.fromNetworkHandle((id shl 32) or 0xcafed00dL)
    private fun caps(unmetered: Boolean = true) = NetworkCapabilities().apply {
        val add = NetworkCapabilities::class.java.getMethod("addCapability", Int::class.javaPrimitiveType)
        add.invoke(this, NetworkCapabilities.NET_CAPABILITY_INTERNET)
        add.invoke(this, NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        if (unmetered) add.invoke(this, NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
    private fun start(id: Long) { engine.select(id); engine.observer.eventWithFile(MPVLib.MpvEvent.MPV_EVENT_START_FILE, id); idle() }
    private fun loaded(id: Long) { engine.observer.eventWithFile(MPVLib.MpvEvent.MPV_EVENT_FILE_LOADED, id); idle() }
    private fun ready(id: Long, position: Double = 37.25) {
        start(id); loaded(id); engine.properties["time-pos"] = position
        engine.observer.eventWithFile(MPVLib.MpvEvent.MPV_EVENT_PLAYBACK_RESTART, id); idle()
    }
    private fun audio(ready: Boolean = true): Long {
        val r = call { module.loadAndPlay(map("url", "https://example.test/a", "mediaId", "a", "loadGeneration", 1.0,
            "duration", 300.0, "autoPlay", false, "requireRenditionProgress", true), it) }
        assertNull(r.code)
        val id = engine.nextId - 1
        if (ready) ready(id) else { start(id); loaded(id); engine.properties["time-pos"] = 0.0 }
        return id
    }
    private fun video(ready: Boolean = true): Long {
        audio()
        val r = call { module.loadAndPlay(videoPayload(2.0, 1.0, "start-zero"), it) }
        assertNull(r.code)
        val id = engine.nextId - 1
        if (ready) ready(id, 12.0)
        return id
    }
    private fun videoPayload(generation: Double, expected: Double, mode: String) = map(
        "url", "https://example.test/mv", "mediaId", "a", "loadGeneration", generation,
        "expectedMediaId", "a", "expectedLoadGeneration", expected, "renditionKind", "mv",
        "positionMode", mode, "videoNetworkPolicy", "unmetered", "videoTimelineId", "cut", "videoIdentity", "mv",
        "requireForeground", false, "autoPlay", false)
    private fun prepare() {
        val r = call { module.prepareNext(map("url", "https://example.test/b", "mediaId", "b", "loadGeneration", 3.0,
            "prepareToken", 1.0, "queueRevision", 1.0, "sourceMediaId", "a", "sourceLoadGeneration", 1.0), it) }
        assertNull(r.code)
    }
    private fun end(id: Long, reason: Int, error: Int = 0, insertId: Long = -1, count: Int = 0) {
        engine.observer.eventEndFile(reason, error, id, insertId, count); idle()
    }
    private fun errors() = events.filter { it.first == "onMpvError" }

    @Before fun setup() {
        engine = Engine()
        module = MpvPlayerModule(BridgeReactContext(RuntimeEnvironment.getApplication()), engine,
            { JavaOnlyMap() }) { name, value -> events.add(name to (value?.toHashMap() ?: emptyMap())) }
        assertNull(call { module.initialize(map(), it) }.code)
        field<VideoNetworkGate>("videoNetworkGate").seed(network(100).networkHandle, true, true, true)
    }
    @After fun cleanup() { call { module.destroy(it) } }

    @Test fun allowedNetworkHandoverWaitsForCapabilities() {
        video(); events.clear()
        callback().onAvailable(network(101)); idle()
        callback().onCapabilitiesChanged(network(101), caps()); idle(1500)
        assertTrue(errors().isEmpty())
        assertFalse(engine.commands.any { it[0] == "stop" })
    }

    @Test fun confirmedDenialStillStopsIfWifiReturnsBeforeMainRuns() {
        video(); events.clear()
        callback().onCapabilitiesChanged(network(100), caps(false))
        callback().onCapabilitiesChanged(network(100), caps())
        idle()
        assertEquals(1, errors().count { it.second["code"] == "E_VIDEO_NETWORK_BLOCKED" })
        assertTrue(engine.commands.any { it[0] == "stop" })
    }

    @Test fun errorInPhysicalGapStillStopsAutomaticRunway() {
        val id = audio(); prepare(); engine.select(null); events.clear()
        end(id, 4, -13)
        assertTrue(engine.commands.any { it[0] == "stop" })
        start(engine.nextId - 1)
        assertTrue(events.none { it.first == "onMpvActiveTrackChanged" })
        assertEquals(1, errors().size)
    }

    @Test fun resumeDuringIdleLoadingDoesNotSeekOrLoseDeferredPosition() {
        audio(false)
        val r = call { module.loadAndPlay(map("url", "https://example.test/a2", "mediaId", "a", "loadGeneration", 2.0,
            "autoPlay", false), it) }
        assertNull(r.code)
        assertNull(call { module.seekTo(42.0, it) }.code)
        assertNull(call { module.resume(it) }.code)
        assertTrue(engine.commands.none { it[0] == "seek" })
        start(engine.nextId - 1); loaded(engine.nextId - 1)
        assertEquals(42.0, engine.properties["time-pos"])
        assertEquals(1, engine.commands.count { it[0] == "seek" && it[1] == "42.0" })
    }

    @Test fun missingReadyAudioClockRejectsVideoBeforePausingOrLoading() {
        audio(false); engine.properties["pause"] = false
        val count = engine.nextId
        val r = call { module.loadAndPlay(videoPayload(2.0, 1.0, "start-zero"), it) }
        assertEquals("E_RENDITION_REJECTED", r.code)
        assertEquals(count, engine.nextId)
        assertEquals(false, engine.properties["pause"])
    }

    @Test fun missingReadyVideoClockRejectsPreservation() {
        val id = video(false); start(id); loaded(id); engine.properties["time-pos"] = 0.0
        val count = engine.nextId
        assertEquals("E_RENDITION_REJECTED", call { module.loadAndPlay(videoPayload(3.0, 2.0, "preserve-mv"), it) }.code)
        assertEquals(count, engine.nextId)
    }

    @Test fun promotionTimeoutCommandFailureDoesNotEscapeLooper() {
        val id = audio(); prepare(); engine.select(null); engine.failStop = true
        end(id, 0); idle(1300)
        assertTrue(errors().isNotEmpty())
        assertTrue(engine.destroyed)
    }

    @Test fun redirectWithTwoEntriesEndsOnlyAfterLastEntry() {
        val id = audio(); events.clear(); engine.select(null)
        end(id, 5, insertId = 20, count = 2)
        engine.playlist[20] = "https://cdn.test/part1"; engine.playlist[21] = "https://cdn.test/part2"
        ready(20); engine.select(null); end(20, 0)
        assertTrue(events.none { it.first == "onMpvEnded" })
        ready(21); engine.select(null); end(21, 0)
        assertEquals(1, events.count { it.first == "onMpvEnded" })
    }

    @Test fun redirectedAudioInfoUsesFileIdentityForBothChecks() {
        val id = audio(); engine.select(null); end(id, 5, insertId = 20, count = 1)
        engine.playlist[20] = "https://cdn.test/audio"; ready(20)
        engine.properties["audio-codec-name"] = "aac"
        engine.properties["audio-params/samplerate"] = 48000.0
        val result = call { module.getAudioInfo(it) }
        assertNotNull(result.value)
        assertEquals("a", (result.value as WritableMap).getString("mediaId"))
    }

    @Test fun fullDestroyClearsNetworkRetirementMarker() {
        video(); engine.failStop = true
        callback().onLost(network(100)); idle()
        assertTrue(engine.destroyed)
        call { module.destroy(it) }
        assertEquals("E_NOT_INIT", call { module.loadAndPlay(map("url", "https://example.test/a"), it) }.code)
    }

    @Test fun absentCapabilitiesHaveABoundedWaitAndBlockNewLoads() {
        video(); events.clear(); callback().onAvailable(network(101)); idle()
        assertTrue(errors().isEmpty())
        assertEquals("E_RENDITION_REJECTED", call { module.loadAndPlay(videoPayload(3.0, 2.0, "start-zero"), it) }.code)
        idle(501)
        assertEquals(1, errors().count { it.second["code"] == "E_VIDEO_NETWORK_BLOCKED" })
    }

    @Test fun aLateOldFileErrorCannotStopANewerExplicitSource() {
        val old = audio()
        assertNull(call { module.loadAndPlay(map("url", "https://example.test/c", "mediaId", "c", "loadGeneration", 4.0,
            "autoPlay", false), it) }.code)
        ready(engine.nextId - 1); events.clear(); end(old, 4, -13)
        assertTrue(errors().isEmpty())
        assertTrue(engine.commands.none { it[0] == "stop" })
    }

    @Test fun sourceRefreshCannotCaptureAnUnreadyAudioClock() {
        audio(false); engine.properties["pause"] = false
        val count = engine.nextId
        assertEquals("E_LOAD", call { module.loadAndPlay(map("url", "https://example.test/a2", "mediaId", "a",
            "loadGeneration", 2.0, "preservePositionFallback", 19.0, "autoPlay", false), it) }.code)
        assertEquals(count, engine.nextId)
        assertEquals(false, engine.properties["pause"])
    }

    @Test fun anEndedIdleAudioResumeRequestsAnAdapterReloadInsteadOfSeekingAnEmptyCore() {
        val id = audio(); engine.select(null); engine.properties["idle-active"] = true; end(id, 0)
        val before = engine.nextId
        assertEquals("E_MPV_RELOAD_REQUIRED", call { module.resume(it) }.code)
        assertEquals(before, engine.nextId)
        assertTrue(engine.commands.none { it[0] == "seek" })
    }

    @Test fun offlineRetryAllowsOnlyAnAdmittedLoopbackProxy() {
        field<VideoNetworkGate>("videoNetworkGate").apply { clearNetwork(); seed(null, false, false, false) }
        assertNull(call { module.loadAndPlay(map("url", "http://127.0.0.1:12345/stream/token", "mediaId", "a",
            "loadGeneration", 1.0, "autoPlay", false, "trustedLocalMediaProxy", true,
            "retryAfterVideoNetworkRetirement", true), it) }.code)
        val before = engine.nextId
        assertNotNull(call { module.loadAndPlay(map("url", "https://example.test/remote", "mediaId", "b",
            "loadGeneration", 2.0, "autoPlay", false, "trustedLocalMediaProxy", true,
            "retryAfterVideoNetworkRetirement", true), it) }.code)
        assertEquals(before, engine.nextId)
    }

    @Test fun preparedRedirectPromotesEverySegmentAndKeepsEachClockIndependent() {
        val id = audio(); prepare(); val preparedId = engine.nextId - 1
        engine.select(null); end(id, 0)
        start(preparedId); engine.select(null); end(preparedId, 5, insertId = 20, count = 2)
        engine.playlist[20] = "https://cdn.test/b1"; engine.playlist[21] = "https://cdn.test/b2"
        ready(20, 3.0)
        assertEquals(1, events.count { it.first == "onMpvActiveTrackChanged" && it.second["mediaId"] == "b" })
        engine.select(null); end(20, 0)
        assertEquals(1, events.count { it.first == "onMpvEnded" })
        start(21); loaded(21)
        val beforeRestart = call { module.getRenditionProgress(it) }.value as WritableMap
        assertFalse(beforeRestart.getBoolean("ready"))
        ready(21, 0.0)
        assertEquals(false, engine.properties["pause"])
        engine.select(null); end(21, 0)
        assertEquals(2, events.count { it.first == "onMpvEnded" })
    }

    @Test fun realRemoteVideoPlayKeepsTheNativeHoldUntilAdmissionClaimsIt() {
        video(); call { module.holdPlayback(it) }; events.clear()
        MpvServiceBridge.playFromOutside("play")
        assertTrue(MpvServiceBridge.playbackHold.blocksAutoPlay)
        assertTrue(events.any { it.first == "onMpvRemoteCommand" && it.second["command"] == "play" })
        call { module.claimPlayback(it) }
        assertFalse(MpvServiceBridge.playbackHold.blocksAutoPlay)
    }

    @Test fun ordinaryRemoteAudioPlayKeepsItsImmediateNativeClaim() {
        audio(); call { module.holdPlayback(it) }
        MpvServiceBridge.playFromOutside("play")
        assertFalse(MpvServiceBridge.playbackHold.blocksAutoPlay)
    }

    @Test fun endedAndErroredAudioAllowQualityRefreshWithPreserveFallback() {
        val endedId = audio()
        engine.select(null); engine.properties["idle-active"] = true
        end(endedId, 0)
        val afterEnded = call { module.loadAndPlay(map("url", "https://example.test/a-flac", "mediaId", "a",
            "loadGeneration", 2.0, "preservePositionFallback", 37.25, "autoPlay", false), it) }
        assertNull(afterEnded.code)
        assertEquals(37.25, afterEnded.value)

        val erroredId = engine.nextId - 1
        ready(erroredId, 41.0)
        end(erroredId, 4, -13)
        val afterError = call { module.loadAndPlay(map("url", "https://example.test/a-hi", "mediaId", "a",
            "loadGeneration", 3.0, "preservePositionFallback", 41.0, "autoPlay", false), it) }
        assertNull(afterError.code)
        assertEquals(41.0, afterError.value)
    }

    @Test fun audioReturnRetrySucceedsOnUnvalidatedLanAndStopClearsVideoRetirementPolicy() {
        video()
        engine.failStop = true
        val unvalidatedLan = NetworkCapabilities().apply {
            val add = NetworkCapabilities::class.java.getMethod("addCapability", Int::class.javaPrimitiveType)
            add.invoke(this, NetworkCapabilities.NET_CAPABILITY_INTERNET)
            add.invoke(this, NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        }
        callback().onCapabilitiesChanged(network(100), unvalidatedLan); idle()
        assertTrue(engine.destroyed)
        assertEquals("E_VIDEO_NETWORK_RETIRED", call { module.loadAndPlay(map(
            "url", "http://192.168.1.50:4533/rest/stream?id=a", "mediaId", "a", "loadGeneration", 3.0,
            "expectedMediaId", "a", "expectedLoadGeneration", 2.0, "renditionKind", "audio",
            "positionMode", "restore-audio", "startPosition", 37.25, "autoPlay", false), it) }.code)
        engine.failStop = false
        assertNull(call { module.initialize(map(), it) }.code)
        assertNull(call { module.loadAndPlay(map(
            "url", "http://192.168.1.50:4533/rest/stream?id=a", "mediaId", "a", "loadGeneration", 3.0,
            "expectedMediaId", "a", "expectedLoadGeneration", 2.0, "renditionKind", "audio",
            "positionMode", "restore-audio", "startPosition", 37.25, "autoPlay", false,
            "retryAfterVideoNetworkRetirement", true), it) }.code)

        // stop() after video-network retirement downgrades to ordinary engine retirement.
        ready(engine.nextId - 1, 37.25)
        field<VideoNetworkGate>("videoNetworkGate").capabilities(network(100).networkHandle, true, true, true)
        assertNull(call { module.loadAndPlay(videoPayload(4.0, 3.0, "start-zero"), it) }.code)
        ready(engine.nextId - 1, 5.0)
        engine.failStop = true
        callback().onLost(network(100)); idle()
        assertNull(call { module.stop(it) }.code)
        assertEquals("E_MPV_ENGINE_RETIRED", call { module.loadAndPlay(map(
            "url", "https://example.test/c", "mediaId", "c", "loadGeneration", 5.0, "autoPlay", false), it) }.code)
    }

    @Test fun failedMvFollowedByNetworkLossDoesNotSpuriouslySuspend() {
        val mvId = video()
        events.clear(); engine.commands.clear()
        end(mvId, 4, -13)
        callback().onLost(network(100)); idle()
        assertEquals(1, errors().count { it.second["code"] == "E_MPV_FILE_END" })
        assertEquals(0, errors().count { it.second["code"] == "E_VIDEO_NETWORK_BLOCKED" })
        assertEquals(1, engine.commands.count { it[0] == "stop" })
        val info = call { module.getVideoInfo(it) }.value as WritableMap
        assertTrue(info.getBoolean("failed"))
        assertFalse(info.getBoolean("suspended"))
    }

    @Test fun engineRebuildAfterPlaybackStopFailurePreservesAudioPlaybackRate() {
        val id = audio()
        assertNull(call { module.setRate(1.5, it) }.code)
        engine.failStop = true
        end(id, 4, -13)
        assertTrue(engine.destroyed)
        assertEquals("E_MPV_ENGINE_RETIRED", call { module.loadAndPlay(map(
            "url", "https://example.test/b", "mediaId", "b", "loadGeneration", 2.0, "autoPlay", false), it) }.code)
        engine.failStop = false
        assertNull(call { module.initialize(map(), it) }.code)
        assertEquals(1.5, engine.properties["speed"])
        assertNull(call { module.loadAndPlay(map(
            "url", "https://example.test/b", "mediaId", "b", "loadGeneration", 2.0, "autoPlay", false), it) }.code)
        assertEquals(1.5, engine.properties["speed"])
    }

    @Test fun endedResumeSeekFailureRequestsAdapterReloadInsteadOfThrowingResumeError() {
        val id = audio()
        end(id, 0)
        engine.properties["idle-active"] = false
        engine.failSeek = true
        assertEquals("E_MPV_RELOAD_REQUIRED", call { module.resume(it) }.code)
    }
}
