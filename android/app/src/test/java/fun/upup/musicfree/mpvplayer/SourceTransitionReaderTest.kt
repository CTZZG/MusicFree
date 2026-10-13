package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceTransitionReaderTest {
    @Test fun readsOnlyTransitionFieldsOnTheCallerThreadInOrder() {
        val caller = Thread.currentThread()
        val reads = mutableListOf<String>()
        fun mark(name: String) { assertEquals(caller, Thread.currentThread()); reads.add(name) }
        val sample = SourceTransitionReader.read(
            clock = { mark("clock"); 100L },
            path = { mark("path"); "source" },
            position = { mark("position"); 12.5 },
            idle = { mark("idle"); false },
            buffering = { mark("buffering"); false },
        )
        assertEquals(listOf("path", "position", "clock", "idle", "buffering", "path"), reads)
        assertEquals(12.5, requireNotNull(sample.rawSeconds), 0.0)
        assertEquals(100L, sample.elapsedMs)
        assertEquals("source", sample.path)
    }

    @Test fun mixedPathsCannotAssignTheOldPositionToTheNewSource() {
        var pathRead = 0
        val sample = SourceTransitionReader.read({ 100L }, { if (pathRead++ == 0) "old" else "new" }, { 100.0 }, { false }, { false })
        assertNull(sample.path)
        val probe = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        assertFalse(probe.observe(sample))
        assertNull(probe.result)
    }

    @Test fun missingEngineReadingsStayMissingWithoutAnyFallback() {
        val sample = SourceTransitionReader.read({ 100L }, { null }, { null }, { null }, { null })
        assertNull(sample.rawSeconds)
        assertNull(sample.idle)
        assertNull(sample.buffering)
        assertNull(sample.path)
    }

    @Test fun skippedNarrowReadsStillCountTowardsTheUnchangedPollingGapLimit() {
        fun sample(ms: Long, path: String?, raw: Double?) = SourceTransitionReader.read({ ms }, { path }, { raw }, { false }, { false })
        val stalled = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        stalled.observe(sample(0, "old", 100.0))
        stalled.observe(sample(400, null, null))
        val rejection = assertThrows(IllegalStateException::class.java) { stalled.observe(sample(500, "new", 100.0)) }
        assertTrue(rejection.message!!.startsWith("TRANSITION_WINDOW:"))
        val continuous = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        continuous.observe(sample(0, "old", 100.0))
        continuous.observe(sample(250, null, null))
        assertTrue(continuous.observe(sample(350, "new", 100.0)))
        assertEquals(250L, requireNotNull(continuous.result).maxPollGapMs)
    }
}
