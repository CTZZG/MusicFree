package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Test

class ReplayGainTest {
    @Test
    fun settingsValuesMapToMpvChoices() {
        assertEquals("track", ReplayGain.mpvValue("track"))
        assertEquals("album", ReplayGain.mpvValue("album"))
        assertEquals("no", ReplayGain.mpvValue("off"))
    }

    @Test
    fun anythingElseTurnsItOff() {
        assertEquals("no", ReplayGain.mpvValue(null))
        assertEquals("no", ReplayGain.mpvValue(""))
        assertEquals("no", ReplayGain.mpvValue("TRACK"))
        assertEquals("no", ReplayGain.mpvValue("track,album"))
    }
}
