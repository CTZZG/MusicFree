package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationUpdateSchedulerTest {
    private class Clock {
        var now = 0L
        val pending = mutableListOf<Pair<Runnable, Long>>()
        fun post(runnable: Runnable, delay: Long) { pending += runnable to now + delay }
        fun cancel(runnable: Runnable) { pending.removeAll { it.first === runnable } }
        fun advanceTo(target: Long) {
            while (true) {
                val due = pending.filter { it.second <= target }.minByOrNull { it.second } ?: break
                pending.remove(due)
                now = due.second
                due.first.run()
            }
            now = target
        }
    }

    private val clock = Clock()
    private var state = "playing"
    private val sent = mutableListOf<Pair<Long, String>>()
    private val scheduler = NotificationUpdateScheduler(
        now = { clock.now }, post = clock::post, cancel = clock::cancel,
        send = { sent += clock.now to state },
    )

    @Test fun aBurstEndsWithTheLatestPausedStateWithoutAnotherProgressTick() {
        scheduler.request()
        repeat(30) { clock.advanceTo(it * 3L); scheduler.request() }
        state = "paused"
        scheduler.request()
        assertEquals(1, clock.pending.size)
        clock.advanceTo(250L)
        assertEquals(listOf(0L to "playing", 250L to "paused"), sent)
        assertTrue(clock.pending.isEmpty())
    }

    @Test fun continuousUpdatesStayBelowFivePerSecondAndKeepTheLastValue() {
        for (time in 0L..2000L step 10L) {
            clock.advanceTo(time)
            state = time.toString()
            scheduler.request()
        }
        clock.advanceTo(2250L)
        for ((index, update) in sent.withIndex()) {
            assertTrue(sent.take(index + 1).count { it.first > update.first - 1000L } <= 4)
        }
        assertEquals("2000", sent.last().second)
    }

    @Test fun theForegroundNotificationCountsTowardTheSameRateBudget() {
        scheduler.onForegroundPosted()
        state = "paused"
        scheduler.request()
        clock.advanceTo(249L)
        assertTrue(sent.isEmpty())
        clock.advanceTo(250L)
        assertEquals(listOf(250L to "paused"), sent)
    }

    @Test fun stoppingCancelsThePendingUpdateAndDoesNotResurrectTheNotification() {
        scheduler.request()
        state = "paused"
        scheduler.request()
        val stale = clock.pending.single().first
        scheduler.cancel()
        stale.run()
        clock.advanceTo(1000L)
        assertEquals(listOf(0L to "playing"), sent)
        assertTrue(clock.pending.isEmpty())
    }

    @Test fun restartingForegroundSupersedesAnOlderQueuedNotification() {
        scheduler.request()
        scheduler.request()
        clock.advanceTo(100L)
        scheduler.onForegroundPosted()
        state = "new track paused"
        scheduler.request()
        clock.advanceTo(349L)
        assertEquals(listOf(0L to "playing"), sent)
        clock.advanceTo(350L)
        assertEquals(350L to "new track paused", sent.last())
    }
}
