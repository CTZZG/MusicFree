package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineProgressMarkerTest {
    @Test fun reportsTheFirstSmallForwardStepOncePerLoad() {
        val marker = EngineProgressMarker()
        marker.onLoad(3)
        assertFalse(marker.onPosition(3, 0.0, paused = false))
        assertTrue(marker.onPosition(3, 0.05, paused = false))
        assertFalse(marker.onPosition(3, 0.1, paused = false))
        marker.onLoad(4)
        assertFalse(marker.onPosition(4, 0.0, paused = false))
        assertTrue(marker.onPosition(4, 0.02, paused = false))
    }

    @Test fun aResumeSeekIsNotProgress() {
        val marker = EngineProgressMarker()
        marker.onLoad(7)
        assertFalse(marker.onPosition(7, 0.0, paused = false))
        // 装载后跳到续播位置：大跳，不算开始推进
        assertFalse(marker.onPosition(7, 62.5, paused = false))
        assertTrue(marker.onPosition(7, 62.53, paused = false))
    }

    @Test fun pausedReadingsAndStaleGenerationsAreIgnored() {
        val marker = EngineProgressMarker()
        assertFalse(marker.onPosition(0, 0.1, paused = false))
        marker.onLoad(2)
        assertFalse(marker.onPosition(1, 0.0, paused = false))
        assertFalse(marker.onPosition(1, 0.1, paused = false))
        assertFalse(marker.onPosition(2, 5.0, paused = true))
        assertFalse(marker.onPosition(2, 5.0, paused = false))
        assertFalse(marker.onPosition(2, 4.9, paused = false))
        assertFalse(marker.onPosition(2, Double.NaN, paused = false))
        assertTrue(marker.onPosition(2, 4.95, paused = false))
    }
}
