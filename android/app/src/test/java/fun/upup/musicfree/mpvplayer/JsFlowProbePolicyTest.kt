package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class JsFlowProbePolicyTest {
    @Test fun everyPhaseIsRequiredAndUnknownPhasesAreRejected() {
        JsFlowProbePolicy.assertComplete(JsFlowProbePolicy.phases)
        for (phase in JsFlowProbePolicy.phases) {
            assertThrows(IllegalStateException::class.java) { JsFlowProbePolicy.assertComplete(JsFlowProbePolicy.phases - phase) }
        }
        assertThrows(IllegalStateException::class.java) { JsFlowProbePolicy.assertComplete(JsFlowProbePolicy.phases + "unknown") }
    }

    @Test fun aQualityReloadMustKeepTheNonzeroResumePosition() {
        JsFlowProbePolicy.assertResumeAnchor(12.0, 14.0)
        JsFlowProbePolicy.assertResumeAnchor(12.0, 10.0)
        for (actual in listOf(0.0, 9.9, 14.1, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertThrows(IllegalStateException::class.java) { JsFlowProbePolicy.assertResumeAnchor(12.0, actual) }
        }
        assertThrows(IllegalStateException::class.java) { JsFlowProbePolicy.assertResumeAnchor(0.0, 0.0) }
    }

    @Test fun focusOwnerMustComeFromTheTopOfTheCurrentStack() {
        val stack = "Audio Focus stack entries (last is top of stack):\n  source:a -- pack: music -- gain: GAIN\n  source:b -- pack: video -- gain: GAIN_TRANSIENT\n\nOther section:\n source:c -- pack: unrelated"
        assertEquals("video", JsFlowProbePolicy.focusOwner(stack))
        assertEquals("music", JsFlowProbePolicy.focusOwner(stack.replace("  source:b -- pack: video -- gain: GAIN_TRANSIENT\n", "")))
        assertEquals(null, JsFlowProbePolicy.focusOwner("not a focus stack"))
        assertEquals(null, JsFlowProbePolicy.focusOwner(stack + "\nAudio Focus stack entries:\n"))
    }

    @Test fun aNewQualitySourceMustNotRewindPastTheOldStop() {
        JsFlowProbePolicy.assertSourceContinuity(12.0, 11.75)
        JsFlowProbePolicy.assertSourceContinuity(12.0, 12.3)
        for (actual in listOf(11.749, 0.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            val failure = assertThrows(IllegalStateException::class.java) {
                JsFlowProbePolicy.assertSourceContinuity(12.0, actual)
            }
            org.junit.Assert.assertTrue(failure.message!!.startsWith("SOURCE_REWIND:"))
        }
        assertThrows(IllegalStateException::class.java) { JsFlowProbePolicy.assertSourceContinuity(Double.NaN, 12.0) }
    }

    @Test fun firstRestoredNewSourceIsKeptEvenWhenLaterPlaybackCatchesUp() {
        fun sample(ms: Long, path: String?, raw: Double?, idle: Boolean = false, buffering: Boolean = false) =
            EngineProgressSample(ms, raw, false, idle, buffering, path, ((raw ?: 0.0) * 1000).toLong(), 3)
        val probe = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        org.junit.Assert.assertFalse(probe.observe(sample(0, "old", 99.9)))
        org.junit.Assert.assertFalse(probe.observe(sample(100, "old", 100.0)))
        org.junit.Assert.assertFalse(probe.observe(sample(200, "old", 0.0)))
        org.junit.Assert.assertFalse(probe.observe(sample(300, "new", 0.0)))
        org.junit.Assert.assertFalse(probe.observe(sample(400, "new", Double.NaN)))
        org.junit.Assert.assertFalse(probe.observe(sample(450, null, 99.6)))
        org.junit.Assert.assertFalse(probe.observe(sample(500, "new", 99.6, buffering = true)))
        org.junit.Assert.assertTrue(probe.observe(sample(600, "new", 99.6)))
        val first = requireNotNull(probe.result)
        val oldPosition = requireNotNull(first.old.rawSeconds)
        val firstPosition = requireNotNull(first.firstNew.rawSeconds)
        assertEquals(100.0, oldPosition, 0.0)
        assertEquals(99.6, firstPosition, 0.0)
        assertEquals(100L, first.pollGapMs)
        assertEquals(100L, first.maxPollGapMs)
        for (ms in 700L..1200L step 100L) {
            org.junit.Assert.assertTrue(probe.observe(sample(ms, "new", 99.6 + (ms - 600) / 1000.0)))
        }
        assertEquals(first, probe.result)
        // The old, delayed window check accepts 100.2; the early read rejects
        // the 0.4-second rewind even though playback caught up afterwards.
        JsFlowProbePolicy.assertSourceContinuity(100.0, 100.2)
        assertThrows(IllegalStateException::class.java) {
            JsFlowProbePolicy.assertSourceContinuity(oldPosition, firstPosition)
        }
        val slow = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        slow.observe(sample(0, "old", 100.0))
        assertThrows(IllegalStateException::class.java) { slow.observe(sample(251, "new", 100.0)) }
    }

    @Test fun everyPollSinceTheLatestValidOldReadMustBeFresh() {
        fun sample(ms: Long, path: String?, raw: Double?, buffering: Boolean = false) =
            EngineProgressSample(ms, raw, false, false, buffering, path, ((raw ?: 0.0) * 1000).toLong(), 3)
        val stalled = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        stalled.observe(sample(0, "old", 100.0))
        stalled.observe(sample(400, null, null))
        stalled.observe(sample(500, "new", 0.0))
        val failure = assertThrows(IllegalStateException::class.java) {
            stalled.observe(sample(600, "new", 100.0))
        }
        org.junit.Assert.assertTrue(failure.message!!.startsWith("TRANSITION_WINDOW:"))

        // A long unload/load is valid if it is continuously observed. Invalid
        // positions and mixed paths must not reset the interval history.
        val continuous = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        continuous.observe(sample(0, "old", 100.0))
        continuous.observe(sample(250, "old", 0.0))
        continuous.observe(sample(500, null, 100.0))
        continuous.observe(sample(750, "new", 100.0, buffering = true))
        org.junit.Assert.assertTrue(continuous.observe(sample(850, "new", 100.0)))
        assertEquals(0L, requireNotNull(continuous.result).old.elapsedMs)
        assertEquals(100L, requireNotNull(continuous.result).pollGapMs)
        assertEquals(250L, requireNotNull(continuous.result).maxPollGapMs)

        // A later valid old reading refreshes the anchor. A gap before that
        // reading is outside the interval being measured.
        val refreshed = JsFlowProbePolicy.SourceTransitionProbe("old", "new")
        refreshed.observe(sample(0, "old", 99.0))
        refreshed.observe(sample(400, null, null))
        refreshed.observe(sample(500, "old", 100.0))
        org.junit.Assert.assertTrue(refreshed.observe(sample(600, "new", 100.0)))
        assertEquals(500L, requireNotNull(refreshed.result).old.elapsedMs)
        assertEquals(100L, requireNotNull(refreshed.result).maxPollGapMs)
    }
}
