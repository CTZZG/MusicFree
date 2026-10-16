package `fun`.upup.musicfree.lyricUtil

/** Desktop lyric settings use CSS/RN hex order (#RRGGBBAA), not Android's #AARRGGBB. */
internal object LyricColors {
    val DEFAULT_TEXT = 0xFFFFE9D2.toInt()
    const val DEFAULT_BACKGROUND = 0x53848881

    fun parse(value: String?, fallback: Int, parseAndroidColor: (String) -> Int): Int {
        val color = value?.trim()?.takeIf { it.isNotEmpty() } ?: return fallback
        if (color.equals("transparent", ignoreCase = true)) return 0
        val expanded = if (color.startsWith("#") && color.length in 4..5) {
            "#" + color.drop(1).flatMap { listOf(it, it) }.joinToString("")
        } else {
            color
        }
        val androidColor = if (expanded.startsWith("#") && expanded.length == 9) {
            "#" + expanded.substring(7, 9) + expanded.substring(1, 7)
        } else {
            expanded
        }
        return try {
            parseAndroidColor(androidColor)
        } catch (_: IllegalArgumentException) {
            // Invalid restored settings must not throw from a posted UI-thread update.
            fallback
        }
    }
}
