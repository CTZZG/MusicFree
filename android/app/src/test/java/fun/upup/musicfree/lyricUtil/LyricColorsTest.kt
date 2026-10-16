package `fun`.upup.musicfree.lyricUtil

import org.junit.Assert.assertEquals
import org.junit.Test

class LyricColorsTest {
    // Hex parsing follows Android's six/eight-digit order; names are delegated unchanged.
    private fun nativeColor(value: String): Int = when (value) {
        "lightgray" -> 0xFFCCCCCC.toInt()
        "red" -> 0xFFFF0000.toInt()
        else -> {
            require(value.startsWith("#") && value.length in listOf(7, 9))
            val parsed = value.drop(1).toLong(16).toInt()
            if (value.length == 7) parsed or 0xFF000000.toInt() else parsed
        }
    }

    @Test fun keepsSixDigitRgbAndConvertsRgbaAlphaToTheFront() {
        assertEquals(0xFF112233.toInt(), LyricColors.parse("#112233", 7, ::nativeColor))
        assertEquals(0x44112233, LyricColors.parse("#11223344", 7, ::nativeColor))
    }

    @Test fun expandsShortCssHexColors() {
        assertEquals(0xFFAABBCC.toInt(), LyricColors.parse("#abc", 7, ::nativeColor))
        assertEquals(0xDDAABBCC.toInt(), LyricColors.parse("#abcd", 7, ::nativeColor))
    }

    @Test fun passesNamedColorsWithoutReorderingNineCharacterNames() {
        assertEquals(0xFFCCCCCC.toInt(), LyricColors.parse("lightgray", 7, ::nativeColor))
        assertEquals(0xFFFF0000.toInt(), LyricColors.parse("red", 7, ::nativeColor))
        assertEquals(0, LyricColors.parse("TRANSPARENT", 7, ::nativeColor))
    }

    @Test fun invalidOrMissingSettingsRetainTheProvidedColor() {
        for (color in listOf(null, "", " ", "not-a-color", "#xyzxyz", "#112233zz", "#12")) {
            assertEquals(color, 0x12345678, LyricColors.parse(color, 0x12345678, ::nativeColor))
        }
        assertEquals(0xFF112233.toInt(), LyricColors.parse("  #112233  ", 7, ::nativeColor))
    }
}
