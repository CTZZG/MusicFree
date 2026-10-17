package `fun`.upup.musicfree.mpvplayer

import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import dev.jdtech.mpv.MPVLib
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Actual bundled decoder and AudioTrack clock; no JS or projected session position. */
class AudioTrackSeekClockTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private var engine: MPVLib? = null
    private val files = mutableListOf<File>()
    private val loaded = AtomicInteger()

    @After
    fun releaseEngine() {
        try {
            engine?.destroy()
        } finally {
            engine = null
            files.forEach { it.delete() }
        }
    }

    @Test
    fun repeatedReplacementKeepsTheRawAudioTrackClockWithinTheRestoreTolerance() {
        val bytes = instrumentation.context.assets.open("seek-clock-tone.mp3").use { it.readBytes() }
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        assertEquals("pinned real-JS MP3 fixture", FIXTURE_SHA256, digest)
        val mpv = requireNotNull(MPVLib.create(context))
        engine = mpv
        mpv.setOptionString("ao", "audiotrack")
        mpv.setOptionString("vo", "null")
        mpv.setOptionString("vid", "no")
        mpv.setOptionString("cache", "yes")
        mpv.setOptionString("cache-secs", "2")
        mpv.setOptionString("demuxer-readahead-secs", "2")
        mpv.setOptionString("gapless-audio", "yes")
        mpv.setOptionString("keep-open", "no")
        mpv.addObserver(object : MPVLib.EventObserver {
            override fun eventProperty(property: String) = Unit
            override fun eventProperty(property: String, value: Long) = Unit
            override fun eventProperty(property: String, value: Double) = Unit
            override fun eventProperty(property: String, value: Boolean) = Unit
            override fun eventProperty(property: String, value: String) = Unit
            override fun event(eventId: Int) {
                if (eventId == 8) loaded.incrementAndGet()
            }
        })
        mpv.init()
        val output = File(context.filesDir, "audiotrack-seek-clock.jsonl")
        output.writeText("")
        var case = 0
        for (nominal in listOf(90.66106863696946, 120.85412625996968)) {
            repeat(3) {
                case += 1
                val old = File.createTempFile("seek-clock-old-", ".mp3", context.cacheDir).also { file ->
                    files.add(file)
                    file.writeBytes(bytes)
                }
                val next = File.createTempFile("seek-clock-new-", ".mp3", context.cacheDir).also { file ->
                    files.add(file)
                    file.writeBytes(bytes)
                }
                mpv.setPropertyBoolean("pause", true)
                load(mpv, old)
                mpv.command(arrayOf("seek", (nominal - 1).toString(), "absolute+exact"))
                mpv.setPropertyBoolean("pause", false)
                await("old source naturally reached target") {
                    (mpv.getPropertyDouble("time-pos") ?: -1.0) >= nominal &&
                        mpv.getPropertyBoolean("seeking") == false
                }
                assertEquals("real AudioTrack backend", "audiotrack", mpv.getPropertyString("current-ao"))
                mpv.setPropertyBoolean("pause", true)
                val target = requireNotNull(mpv.getPropertyDouble("time-pos"))
                load(mpv, next)
                mpv.command(arrayOf("seek", target.toString(), "absolute"))
                val start = SystemClock.elapsedRealtime()
                mpv.setPropertyBoolean("pause", false)

                var firstValidAt: Long? = null
                var lastValidAt: Long? = null
                var minimum = Double.POSITIVE_INFINITY
                var maxGap = 0L
                val samples = JSONArray()
                while (firstValidAt == null || SystemClock.elapsedRealtime() - firstValidAt < 1200) {
                    if (SystemClock.elapsedRealtime() - start >= 10000) break
                    val before = mpv.getPropertyString("path")
                    val raw = mpv.getPropertyDouble("time-pos")
                    val seeking = mpv.getPropertyBoolean("seeking")
                    val after = mpv.getPropertyString("path")
                    val now = SystemClock.elapsedRealtime()
                    // Exclude the known unload/seek placeholder, never a ready sample.
                    // A wrong restart at zero still fails the deadline/target check.
                    if (before == next.absolutePath && after == before && raw != null && raw >= 3 && seeking == false) {
                        if (firstValidAt == null) firstValidAt = now
                        lastValidAt?.let { previous ->
                            maxGap = maxOf(maxGap, now - previous)
                        }
                        lastValidAt = now
                        minimum = minOf(minimum, raw)
                        samples.put(JSONObject().put("elapsedMs", now).put("raw", raw)
                            .put("seeking", seeking).put("path", after))
                    }
                    Thread.sleep(25)
                }
                val row = JSONObject().put("phase", "audiotrack-seek-clock").put("case", case)
                    .put("fixtureSha256", digest).put("ao", mpv.getPropertyString("current-ao"))
                    .put("newPath", next.absolutePath).put("nominalTarget", nominal)
                    .put("startedAtMs", start)
                    .put("target", target).put("minimum", if (minimum.isFinite()) minimum else JSONObject.NULL)
                    .put("maxGapMs", maxGap).put("samples", samples)
                output.appendText("$row\n")
                Log.i("AudioTrackSeekClock", row.toString())
                assertTrue("raw window has at least ten observations", samples.length() >= 10)
                assertTrue("raw window covers at least one second", requireNotNull(lastValidAt) - requireNotNull(firstValidAt) >= 1000)
                assertTrue("raw clock observation gap exceeded 250ms: $maxGap", maxGap <= 250)
                assertTrue("SOURCE_REWIND: AudioTrack raw $minimum before target $target", minimum >= target - 0.25)
                for (index in 0 until samples.length()) {
                    val sample = samples.getJSONObject(index)
                    val elapsed = (sample.getLong("elapsedMs") - start) / 1000.0
                    assertTrue("raw clock advanced faster than elapsed playback time", sample.getDouble("raw") <= target + elapsed + 0.25)
                }
                assertTrue("restored source really progressed", samples.getJSONObject(samples.length() - 1).getDouble("raw") >= samples.getJSONObject(0).getDouble("raw") + 0.25)
                mpv.setPropertyBoolean("pause", true)
                mpv.command(arrayOf("stop"))
            }
        }
        assertEquals("all repeated source replacements completed", 6, case)
    }

    private fun load(mpv: MPVLib, file: File) {
        val previous = loaded.get()
        mpv.command(arrayOf("loadfile", file.absolutePath, "replace"))
        await("FILE_LOADED for new path") { loaded.get() > previous && mpv.getPropertyString("path") == file.absolutePath }
    }

    private fun await(description: String, condition: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + 20000
        while (!condition()) {
            assertTrue(description, SystemClock.elapsedRealtime() < until)
            Thread.sleep(20)
        }
    }

    companion object {
        private const val FIXTURE_SHA256 = "416b824e4a3ca8e25ffb9ae46c2fcdb99442fb15e6040fdd7ccfa116857297f4"
    }
}
