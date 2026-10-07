package `fun`.upup.musicfree.mpvplayer

import `fun`.upup.musicfree.mpvplayer.ArtworkLoadTracker.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ArtworkLoadTrackerTest {
    private val coverA = "https://img.example/a.jpg"
    private val coverB = "https://img.example/b.jpg"

    @Test
    fun aTrackWithoutArtworkStartsNoRequest() {
        val tracker = ArtworkLoadTracker()

        assertNull(tracker.begin(null))
        assertNull(tracker.begin("  "))
        assertNull(tracker.nextAttempt())
    }

    @Test
    fun transientFailuresRetryWithBackoffAndThenGiveUp() {
        val tracker = ArtworkLoadTracker()
        var attempt = tracker.begin(coverA)!!
        val delays = mutableListOf<Long>()

        while (true) {
            when (val outcome = tracker.onFailure(attempt, retryable = true)) {
                is Outcome.Retry -> delays += outcome.delayMs
                Outcome.GiveUp -> break
                else -> throw AssertionError("unexpected $outcome")
            }
            attempt = tracker.nextAttempt()!!
        }

        assertEquals(ArtworkLoadTracker.DEFAULT_RETRY_DELAYS_MS, delays)
        assertEquals(ArtworkLoadTracker.DEFAULT_RETRY_DELAYS_MS.size + 1, attempt.number)
    }

    @Test
    fun aPermanentFailureGivesUpWithoutRetrying() {
        val tracker = ArtworkLoadTracker()
        val attempt = tracker.begin(coverA)!!

        assertEquals(Outcome.GiveUp, tracker.onFailure(attempt, retryable = false))
    }

    @Test
    fun aRetryThatSucceedsIsAppliedAndEndsTheRound() {
        val tracker = ArtworkLoadTracker()
        val first = tracker.begin(coverA)!!
        assertEquals(Outcome.Retry(2_000L), tracker.onFailure(first, retryable = true))

        val second = tracker.nextAttempt()!!
        assertTrue(tracker.shouldFetch(second))
        assertEquals(Outcome.Apply, tracker.onSuccess(second))

        assertNull(tracker.nextAttempt())
        assertFalse(tracker.shouldFetch(second))
    }

    @Test
    fun resultsForAPreviousTrackAreDiscarded() {
        val tracker = ArtworkLoadTracker()
        val oldAttempt = tracker.begin(coverA)!!
        val newAttempt = tracker.begin(coverB)!!

        // Queued behind the new track: skip the network entirely.
        assertFalse(tracker.shouldFetch(oldAttempt))
        assertEquals(Outcome.Stale, tracker.onSuccess(oldAttempt))
        assertEquals(Outcome.Stale, tracker.onFailure(oldAttempt, retryable = true))

        assertTrue(tracker.shouldFetch(newAttempt))
        assertEquals(Outcome.Apply, tracker.onSuccess(newAttempt))
    }

    @Test
    fun aNewRoundForTheSameArtworkStillAcceptsTheEarlierImage() {
        // Title or album metadata changed but the cover URL did not.
        val tracker = ArtworkLoadTracker()
        val earlier = tracker.begin(coverA)!!
        val current = tracker.begin(coverA)!!

        assertEquals(Outcome.Stale, tracker.onFailure(earlier, retryable = true))
        assertEquals(Outcome.Apply, tracker.onSuccess(earlier))
        assertEquals(Outcome.Stale, tracker.onFailure(current, retryable = true))
    }

    @Test
    fun onlyTheLatestAttemptOfARoundSchedulesARetry() {
        val tracker = ArtworkLoadTracker()
        val first = tracker.begin(coverA)!!
        assertEquals(Outcome.Retry(2_000L), tracker.onFailure(first, retryable = true))
        val second = tracker.nextAttempt()
        assertNotNull(second)

        // A duplicate failure report for the first attempt must not start a
        // second retry timer next to the one already pending.
        assertEquals(Outcome.Stale, tracker.onFailure(first, retryable = true))
        assertEquals(Outcome.Retry(5_000L), tracker.onFailure(second!!, retryable = true))
    }

    @Test
    fun serverErrorsAndThrottlingAreRetryableButOtherClientErrorsAreNot() {
        listOf(408, 429, 500, 502, 503, 504).forEach {
            assertTrue("$it", ArtworkLoadTracker.isRetryableHttpStatus(it))
        }
        listOf(400, 401, 403, 404, 410).forEach {
            assertFalse("$it", ArtworkLoadTracker.isRetryableHttpStatus(it))
        }
    }
}
