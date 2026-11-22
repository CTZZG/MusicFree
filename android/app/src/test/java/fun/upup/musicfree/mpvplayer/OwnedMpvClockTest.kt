package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.*
import org.junit.Test

class OwnedMpvClockTest {
    @Test fun stableOwnerGetsTheActualClock() {
        assertEquals(37.5, OwnedMpvClock.read("A", { 1 }, { "A" }, { 37.5 })!!, 0.0)
    }

    @Test fun promotionBetweenIdentityAndClockCannotReturnTheSuccessorClock() {
        val ids = listOf(1L, 2L).iterator()
        assertNull(OwnedMpvClock.read("A", { ids.next() }, { if (it == 1L) "A" else "B" }, { 0.2 }))
    }

    @Test fun foreignOwnerIsRejectedBeforeReadingItsClock() {
        var read = false
        assertNull(OwnedMpvClock.read("A", { 2 }, { "B" }, { read = true; 0.2 }))
        assertFalse(read)
    }

    @Test fun unavailableOrInvalidClocksAreNeverReady() {
        for (value in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -0.1)) {
            assertNull(OwnedMpvClock.read("A", { 1 }, { "A" }, { value }))
        }
    }

    @Test fun identityRevocationDuringTheReadInvalidatesTheSample() {
        var owner: String? = "A"
        assertNull(OwnedMpvClock.read("A", { 1 }, { owner }, { owner = null; 37.5 }))
    }
}
