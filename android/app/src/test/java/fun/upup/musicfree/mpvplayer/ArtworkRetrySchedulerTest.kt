package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 回归背景（外部复审）：关闭播放通知后，还没到点的封面重试照样执行，取到图就
 * 调 updateNotification，把用户刚关掉的通知又发了出来。
 */
class ArtworkRetrySchedulerTest {
    private class FakeHandler {
        val pending = mutableListOf<Pair<Runnable, Long>>()

        fun post(runnable: Runnable, delayMs: Long) {
            pending += runnable to delayMs
        }

        fun cancel(runnable: Runnable) {
            pending.removeAll { it.first === runnable }
        }

        fun runAll() {
            val due = pending.toList()
            pending.clear()
            due.forEach { it.first.run() }
        }
    }

    private val handler = FakeHandler()
    private var retries = 0
    private val scheduler = ArtworkRetryScheduler(
        post = handler::post,
        cancel = handler::cancel,
        retry = { retries += 1 },
    )

    @Test
    fun `a failure while playing retries after the backoff`() {
        scheduler.schedule(5_000L, playbackStopped = false)

        assertEquals(listOf(5_000L), handler.pending.map { it.second })
        handler.runAll()
        assertEquals(1, retries)
    }

    @Test
    fun `stopping playback holds the pending retry until playback starts again`() {
        scheduler.schedule(5_000L, playbackStopped = false)

        scheduler.onPlaybackStopped()
        assertTrue(handler.pending.isEmpty())
        handler.runAll()
        assertEquals(0, retries)

        scheduler.onPlaybackStarted()
        assertEquals(listOf(0L), handler.pending.map { it.second })
        handler.runAll()
        assertEquals(1, retries)
    }

    @Test
    fun `a failure that arrives after stopping waits for the next playback`() {
        scheduler.schedule(2_000L, playbackStopped = true)

        assertTrue(handler.pending.isEmpty())
        scheduler.onPlaybackStarted()
        handler.runAll()
        assertEquals(1, retries)
    }

    @Test
    fun `starting playback with nothing deferred does not fetch`() {
        scheduler.onPlaybackStarted()
        scheduler.onPlaybackStopped()
        scheduler.onPlaybackStarted()

        assertTrue(handler.pending.isEmpty())
        assertEquals(0, retries)
    }

    @Test
    fun `a new track drops the previous track's retries`() {
        scheduler.schedule(5_000L, playbackStopped = false)
        scheduler.onPlaybackStopped()

        scheduler.reset()
        scheduler.onPlaybackStarted()

        assertTrue(handler.pending.isEmpty())
        assertEquals(0, retries)
    }
}
