package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingSeekTest {
    @Test fun peekingTheLatestTargetDoesNotConsumeIt() {
        val pending = PendingSeek()
        pending.defer(7, 30.4)
        assertEquals(30.4, pending.peek(7)!!, 0.0)
        assertNull(pending.peek(8))
        pending.defer(7, 0.0)
        assertEquals(0.0, pending.peek(7)!!, 0.0)
        assertEquals(0.0, pending.take(7)!!, 0.0)
        assertNull(pending.peek(7))
    }

    @Test fun loadingRestorationBlocksUnpauseUntilItIsTakenOrReset() {
        val pending = PendingSeek()
        assertFalse(pending.isPendingFor(7))
        pending.defer(7, 30.4)
        assertTrue(pending.isPendingFor(7))
        assertFalse(pending.isPendingFor(8))
        pending.take(7)
        assertFalse(pending.isPendingFor(7))
        pending.defer(8, 0.0)
        assertTrue(pending.isPendingFor(8))
        pending.reset()
        assertFalse(pending.isPendingFor(8))
    }

    @Test
    fun aSeekMadeWhileTheFileLoadsRunsOnceThatFileHasLoaded() {
        val pending = PendingSeek()
        pending.reset()
        pending.defer(loadingGeneration = 7, seconds = 62.5)

        assertEquals(62.5, pending.take(loadedGeneration = 7)!!, 0.0)
        // 只执行一次
        assertNull(pending.take(loadedGeneration = 7))
    }

    @Test
    fun theLatestSeekWins() {
        val pending = PendingSeek()
        pending.defer(loadingGeneration = 3, seconds = 10.0)
        pending.defer(loadingGeneration = 3, seconds = 40.0)

        assertEquals(40.0, pending.take(loadedGeneration = 3)!!, 0.0)
    }

    @Test
    fun aSeekMeantForAnEarlierFileIsDropped() {
        val pending = PendingSeek()
        pending.defer(loadingGeneration = 3, seconds = 40.0)
        // 还没加载好就换了下一首
        pending.reset()

        assertNull(pending.take(loadedGeneration = 4))
    }

    @Test
    fun aSeekFromAnotherGenerationDoesNotMoveTheLoadedFile() {
        val pending = PendingSeek()
        pending.defer(loadingGeneration = 3, seconds = 40.0)

        assertNull(pending.take(loadedGeneration = 4))
        assertNull(pending.take(loadedGeneration = 3))
    }

    @Test
    fun negativePositionsStartFromTheBeginning() {
        val pending = PendingSeek()
        pending.defer(loadingGeneration = 1, seconds = -2.0)

        assertEquals(0.0, pending.take(loadedGeneration = 1)!!, 0.0)
    }
}
