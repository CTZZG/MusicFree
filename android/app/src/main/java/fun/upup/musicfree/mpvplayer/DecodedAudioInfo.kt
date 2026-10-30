package `fun`.upup.musicfree.mpvplayer

/** Decoded file parameters, never the requested quality or the hardware output. */
internal data class DecodedAudioInfo(
    val codec: String?,
    val sampleRate: Int?,
    val channelCount: Int?,
    val bitrate: Double?,
) {
    companion object {
        fun read(text: (String) -> String?, number: (String) -> Double?): DecodedAudioInfo {
            fun value(property: String): Double? = try {
                number(property)?.takeIf { it.isFinite() && it > 0 }
            } catch (_: Exception) { null }
            fun integer(property: String, max: Int): Int? = value(property)
                ?.takeIf { it <= max && it == it.toInt().toDouble() }?.toInt()
            val codec = try {
                text("audio-codec-name")?.trim()?.takeIf {
                    it.matches(Regex("[A-Za-z0-9_.+ -]{1,64}"))
                }
            } catch (_: Exception) { null }
            return DecodedAudioInfo(
                codec,
                integer("audio-params/samplerate", 3_840_000),
                integer("audio-params/channel-count", 64),
                value("audio-bitrate")?.takeIf { it <= 1_000_000_000 },
            )
        }
    }
}
