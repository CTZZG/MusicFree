package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SourceReplacementPositionTest {
    @Test fun aLoadingReplacementKeepsItsDeferredTargetInsteadOfItsTemporaryZero() {
        assertEquals(30.4, SourceReplacementPosition.capture(0.0, true, {},
            position = { error("temporary new-file position must not replace the pending target") },
            pendingPosition = 30.4,
        ), 0.0)
    }

    @Test fun aNewUserSeekToZeroOverridesThePriorPendingPosition() {
        assertEquals(0.0, SourceReplacementPosition.capture(30.4, true, {}, { 10.0 }, pendingPosition = 0.0), 0.0)
    }

    @Test fun capturesAfterStoppingEvenIfTheStopWasDelayed() {
        val calls = mutableListOf<String>()
        var progress = 30.0
        val restored = SourceReplacementPosition.capture(30.0, true,
            pause = { calls.add("pause"); progress += 0.4 },
            position = { calls.add("position"); progress },
        )
        assertEquals(listOf("pause", "position"), calls)
        assertEquals(30.4, restored, 0.0)
    }

    @Test fun aDifferentMediaDoesNotContributeItsPosition() {
        val restored = SourceReplacementPosition.capture(30.0, false,
            pause = { error("must not stop unrelated media to capture it") },
            position = { error("must not read unrelated media") },
        )
        assertEquals(30.0, restored, 0.0)
    }

    @Test fun aUserSeekToZeroIsPreserved() {
        assertEquals(0.0, SourceReplacementPosition.capture(30.0, true, {}, { 0.0 }), 0.0)
    }

    @Test fun missingOrInvalidReadingsUseTheFallback() {
        for (raw in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0)) {
            assertEquals(30.0, SourceReplacementPosition.capture(30.0, true, {}, { raw }), 0.0)
        }
    }

    @Test fun aFailedReadUsesTheFallback() {
        assertEquals(30.0, SourceReplacementPosition.capture(30.0, true, {}, { error("unavailable") }), 0.0)
    }

    @Test fun aFailedStopAbortsRatherThanUsingARunningSnapshot() {
        assertThrows(IllegalStateException::class.java) {
            SourceReplacementPosition.capture(30.0, true, { error("cannot stop") }, { error("must not read") })
        }
    }
}
