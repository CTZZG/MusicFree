package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MpvServiceLifecycleTest {
    @Test
    fun estimateNotificationPositionUsesPreviousSpeedBeforeRateChange() {
        // Played 4 seconds at 2.0x starting from 10_000ms -> 18_000ms before switching to 1.0x.
        val beforeSwitch = MpvPlaybackService.estimateNotificationPositionMs(
            cachedPosition = 10_000L,
            cachedDuration = 60_000L,
            isPlaying = true,
            updatedAtMs = 1_000L,
            nowElapsedMs = 5_000L,
            speed = 2.0f,
        )
        assertEquals(18_000L, beforeSwitch)

        // Subsequent 3 seconds at 1.0x from the snapshotted 18_000ms -> 21_000ms.
        val afterSwitch = MpvPlaybackService.estimateNotificationPositionMs(
            cachedPosition = beforeSwitch,
            cachedDuration = 60_000L,
            isPlaying = true,
            updatedAtMs = 5_000L,
            nowElapsedMs = 8_000L,
            speed = 1.0f,
        )
        assertEquals(21_000L, afterSwitch)
    }

    @Test
    fun carQueryCoalescerRunsSingleActiveQueryAndOneTrailingRecheck() {
        val coalescer = MpvAndroidAutoConnectionDetector.CarQueryCoalescer()
        val gen = coalescer.beginRegistration()

        assertEquals(gen, coalescer.tryAcquire())
        // Burst of 3 broadcasts while first query is in flight coalesces into 1 trailing query.
        assertNull(coalescer.tryAcquire())
        assertNull(coalescer.tryAcquire())
        assertNull(coalescer.tryAcquire())

        assertTrue(coalescer.onComplete(gen, registered = true))
        val rerunGen = coalescer.tryAcquire()
        assertEquals(gen, rerunGen)
        // Trailing query is now active; another completion with no new broadcasts stops cleanly.
        assertFalse(coalescer.onComplete(gen, registered = true))

        // Unregister clears both in-flight and pending flags.
        assertNotNull(coalescer.tryAcquire())
        assertNull(coalescer.tryAcquire())
        coalescer.reset()
        assertFalse(coalescer.onComplete(gen, registered = false))
        val nextGen = coalescer.beginRegistration()
        assertEquals(nextGen, coalescer.tryAcquire())
    }

    @Test
    fun carQueryCoalescerIgnoresLateCompletionFromPreviousRegistrationCycle() {
        val coalescer = MpvAndroidAutoConnectionDetector.CarQueryCoalescer()
        val gen1 = coalescer.beginRegistration()
        assertEquals(gen1, coalescer.tryAcquire())

        // Unregister while gen1 query reply is already queued on main looper, then re-register.
        coalescer.endRegistration()
        val gen2 = coalescer.beginRegistration()
        assertEquals(gen2, coalescer.tryAcquire())
        // Broadcast arrives during gen2 in-flight query -> marks pending for gen2.
        assertNull(coalescer.tryAcquire())

        // Late gen1 callback must be rejected and must NOT clear gen2's in-flight/pending state.
        assertFalse(coalescer.isCurrentActive(gen1, registered = true))
        assertFalse(coalescer.onComplete(gen1, registered = true))
        assertNull(coalescer.tryAcquire())

        // Real gen2 completion remains active and triggers the coalesced recheck.
        assertTrue(coalescer.isCurrentActive(gen2, registered = true))
        assertTrue(coalescer.onComplete(gen2, registered = true))
    }

    @Test
    fun foregroundFailureAbortsPlaybackOnlyWhenUnpromotedStartWasRequestedOrStopping() {
        assertTrue(
            MpvPlaybackService.shouldAbortPlaybackAfterForegroundFailure(
                foregroundStartRequested = true,
                stoppingForFailedForeground = false,
                isForeground = false,
            ),
        )
        assertTrue(
            MpvPlaybackService.shouldAbortPlaybackAfterForegroundFailure(
                foregroundStartRequested = false,
                stoppingForFailedForeground = true,
                isForeground = false,
            ),
        )
        assertFalse(
            MpvPlaybackService.shouldAbortPlaybackAfterForegroundFailure(
                foregroundStartRequested = true,
                stoppingForFailedForeground = true,
                isForeground = true,
            ),
        )
        assertFalse(
            MpvPlaybackService.shouldAbortPlaybackAfterForegroundFailure(
                foregroundStartRequested = false,
                stoppingForFailedForeground = false,
                isForeground = false,
            ),
        )
    }
}
