package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveUpdateLyricStateTest {
    @Test
    fun anEmptyLineDoesNotSwitchLiveUpdateOff() {
        val state = LiveUpdateLyricState()
        state.setEnabled(true)
        state.setLyric("屋顶灰色瓦片 安静的画面")

        // 间奏、前奏：这会儿没有歌词，只是标题换回歌名
        assertTrue(state.setLyric(""))
        assertTrue(state.enabled)
        assertEquals("", state.lyric)
        assertFalse(state.setLyric(null))
        assertTrue(state.enabled)
    }

    @Test
    fun aNewTrackKeepsTheSwitchAndDropsTheOldLine() {
        val state = LiveUpdateLyricState()
        state.setLyric("终于找到所有流浪的终点")

        state.clearLyric()

        assertTrue(state.enabled)
        assertEquals("", state.lyric)
    }

    @Test
    fun aLineArrivingBeforeTheSwitchIsSyncedTurnsLiveUpdateOn() {
        // 应用刚启动，开关还没从 JS 同步过来，第一句歌词已经到了
        val state = LiveUpdateLyricState()

        assertTrue(state.setLyric("第一句"))

        assertTrue(state.enabled)
        assertEquals("第一句", state.lyric)
    }

    @Test
    fun onlyTurningTheSwitchOffSwitchesBackToTheMediaStyle() {
        val state = LiveUpdateLyricState()
        state.setLyric("第一句")

        assertTrue(state.setEnabled(false))

        assertFalse(state.enabled)
        assertEquals("", state.lyric)
        // 关着时 JS 不会再发歌词；发来空的也不会打开
        assertFalse(state.setLyric(""))
        assertFalse(state.enabled)
    }

    @Test
    fun repeatsDoNotRepostTheNotification() {
        val state = LiveUpdateLyricState()
        state.setEnabled(true)

        assertFalse(state.setEnabled(true))
        assertTrue(state.setLyric(" 第一句 "))
        assertFalse(state.setLyric("第一句"))
        assertFalse(state.setLyric("  第一句"))
    }
}
