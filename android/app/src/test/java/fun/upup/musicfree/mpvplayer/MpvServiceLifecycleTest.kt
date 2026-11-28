package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

        assertTrue(coalescer.tryAcquire())
        // Burst of 3 broadcasts while first query is in flight coalesces into 1 trailing query.
        assertFalse(coalescer.tryAcquire())
        assertFalse(coalescer.tryAcquire())
        assertFalse(coalescer.tryAcquire())

        assertTrue(coalescer.onComplete(registered = true))
        // Trailing query is now active; another completion with no new broadcasts stops cleanly.
        assertFalse(coalescer.onComplete(registered = true))

        // Unregister clears both in-flight and pending flags.
        assertTrue(coalescer.tryAcquire())
        assertFalse(coalescer.tryAcquire())
        coalescer.reset()
        assertFalse(coalescer.onComplete(registered = false))
        assertTrue(coalescer.tryAcquire())
    }
}
