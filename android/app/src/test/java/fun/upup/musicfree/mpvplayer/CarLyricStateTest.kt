package `fun`.upup.musicfree.mpvplayer

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CarLyricStateTest {
    @Test
    fun theLyricIsShownOnlyWhenEnabledAndACarCanSeeIt() {
        val state = CarLyricState()
        state.setLyric("  第一句  ")
        assertEquals("", state.displayedLyric(androidAutoConnected = true))

        state.setEnabled(true)
        state.setLyric("第一句")
        assertEquals("", state.displayedLyric(androidAutoConnected = false))
        assertEquals("第一句", state.displayedLyric(androidAutoConnected = true))

        state.setBluetoothOutput(true)
        assertEquals("第一句", state.displayedLyric(androidAutoConnected = false))
    }

    @Test
    fun changesAreReportedOnlyWhenSomethingChanged() {
        val state = CarLyricState()
        assertTrue(state.setEnabled(true))
        assertFalse(state.setEnabled(true))
        assertTrue(state.setLyric("a"))
        assertFalse(state.setLyric(" a "))
        assertTrue(state.clearLyric())
        assertFalse(state.clearLyric())
        assertTrue(state.setBluetoothOutput(true))
        assertFalse(state.setBluetoothOutput(true))
    }

    @Test
    fun turningItOffForgetsTheCurrentLine() {
        val state = CarLyricState()
        state.setEnabled(true)
        state.setBluetoothOutput(true)
        state.setLyric("a")
        state.setEnabled(false)
        state.setEnabled(true)
        assertEquals("", state.displayedLyric(androidAutoConnected = false))
    }

    @Test
    fun bluetoothMediaOutputsAreRecognised() {
        assertTrue(
            CarLyricState.isBluetoothMediaOutput(
                listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP),
            ),
        )
        assertTrue(CarLyricState.isBluetoothMediaOutput(listOf(AudioDeviceInfo.TYPE_BLE_SPEAKER)))
        // 只有通话用的 SCO、有线耳机、扬声器时不算
        assertFalse(
            CarLyricState.isBluetoothMediaOutput(
                listOf(
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
                ),
            ),
        )
        assertFalse(CarLyricState.isBluetoothMediaOutput(emptyList()))
    }
}
