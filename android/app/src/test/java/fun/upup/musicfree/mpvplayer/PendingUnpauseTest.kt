package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingUnpauseTest {
    @Test
    fun aLoadThatShouldPlayKeepsUnpausingThatGeneration() {
        val pending = PendingUnpause()
        pending.arm(generation = 5)

        assertTrue(pending.isArmedFor(generation = 5))
        // 换了下一首之后，上一代排着的重试不算数
        assertFalse(pending.isArmedFor(generation = 4))
    }

    @Test
    fun anExplicitPauseStopsTheRetriesStillQueuedForThatGeneration() {
        val pending = PendingUnpause()
        pending.arm(generation = 5)
        // 装载后 0.7 秒内用户暂停：0/80/250/700ms 的重试和之后的
        // PLAYBACK_RESTART 都不能再取消暂停
        pending.cancel()

        assertFalse(pending.isArmedFor(generation = 5))
    }

    @Test
    fun resumingArmsItAgain() {
        val pending = PendingUnpause()
        pending.arm(generation = 5)
        pending.cancel()
        pending.arm(generation = 5)

        assertTrue(pending.isArmedFor(generation = 5))
    }

    @Test
    fun nothingIsArmedBeforeTheFirstLoad() {
        assertFalse(PendingUnpause().isArmedFor(generation = -1))
        assertFalse(PendingUnpause().isArmedFor(generation = 0))
    }
}
