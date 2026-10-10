package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackHoldTest {
    @Test
    fun nothingIsHeldAtFirst() {
        assertFalse(PlaybackHold().blocksAutoPlay)
    }

    @Test
    fun anExternalPauseHoldsUntilTheUserPlaysAgain() {
        val hold = PlaybackHold()
        // 通知栏、锁屏、耳机暂停：装载完成、恢复后的重试都不能再放出来
        hold.pauseByUser()
        assertTrue(hold.blocksAutoPlay)
        // 系统还回焦点不解除用户暂停
        assertFalse(hold.endInterruption())
        assertTrue(hold.blocksAutoPlay)

        hold.claim()
        assertFalse(hold.blocksAutoPlay)
    }

    @Test
    fun aTransientInterruptionEndsWhenTheSystemGivesFocusBack() {
        val hold = PlaybackHold()
        hold.interrupt()
        // 打断期间自动出声会把焦点抢回来
        assertTrue(hold.blocksAutoPlay)

        // 还回焦点：告诉 JS 打断结束了，由它决定要不要接着放
        assertTrue(hold.endInterruption())
        assertFalse(hold.blocksAutoPlay)
        // 再来一次 GAIN 不算新的打断结束
        assertFalse(hold.endInterruption())
    }

    @Test
    fun aPauseDuringTheInterruptionOutlastsIt() {
        val hold = PlaybackHold()
        hold.interrupt()
        hold.pauseByUser()

        assertTrue(hold.endInterruption())
        assertTrue(hold.blocksAutoPlay)
    }

    @Test
    fun theUserPlayingDuringAnInterruptionEndsItEarly() {
        val hold = PlaybackHold()
        hold.interrupt()
        hold.claim()

        assertFalse(hold.blocksAutoPlay)
        // 之后系统还回焦点，不再通知 JS 接着放
        assertFalse(hold.endInterruption())
    }
}
