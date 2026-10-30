package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.*
import org.junit.Test

class DecodedAudioInfoTest {
    @Test fun readsOnlyDecodedFileParameters() {
        val requested = mutableListOf<String>()
        val values = mapOf("audio-params/samplerate" to 44100.0, "audio-params/channel-count" to 2.0, "audio-bitrate" to 192123.0)
        val result = DecodedAudioInfo.read({ requested.add(it); "mp3" }, { requested.add(it); values[it] })
        assertEquals(DecodedAudioInfo("mp3", 44100, 2, 192123.0), result)
        assertEquals(setOf("audio-codec-name", "audio-params/samplerate", "audio-params/channel-count", "audio-bitrate"), requested.toSet())
    }
    @Test fun unavailablePropertiesStayUnknownWithoutQualityInference() {
        assertEquals(DecodedAudioInfo(null, null, null, null), DecodedAudioInfo.read({ null }, { null }))
        val result = DecodedAudioInfo.read({ throw IllegalStateException("unsupported") }, { if (it == "audio-params/samplerate") 48000.0 else throw IllegalStateException("unsupported") })
        assertEquals(DecodedAudioInfo(null, 48000, null, null), result)
    }
    @Test fun refusesCredentialLikeOrControlCharacterCodecText() {
        for (text in listOf("https://user:password@example.test/audio", "mp3\nsecret", "x".repeat(65))) {
            assertNull(DecodedAudioInfo.read({ text }, { 0.0 }).codec)
        }
    }
    @Test fun rejectsInvalidNumericValues() {
        for (number in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 0.0, 4_000_000_000.0)) {
            assertEquals(DecodedAudioInfo("flac", null, null, null), DecodedAudioInfo.read({ "flac" }, { number }))
        }
        val fractional = DecodedAudioInfo.read({ "aac" }, { 1.5 })
        assertNull(fractional.sampleRate); assertNull(fractional.channelCount)
        assertEquals(1.5, fractional.bitrate!!, 0.0)
    }
}
