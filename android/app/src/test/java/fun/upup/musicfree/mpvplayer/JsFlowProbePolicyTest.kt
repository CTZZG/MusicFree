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
}
