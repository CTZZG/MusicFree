package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingSeekTest {
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
