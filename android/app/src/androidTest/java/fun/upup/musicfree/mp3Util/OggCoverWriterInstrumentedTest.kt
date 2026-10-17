package `fun`.upup.musicfree.mp3Util

import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OggCoverWriterInstrumentedTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun withTrack(block: (File, ByteArray) -> Unit) {
        val dir = File(instrumentation.targetContext.cacheDir, "ogg-cover-instrumentation").apply { mkdirs() }
        try {
            val file = File(dir, "tone.ogg")
            instrumentation.context.assets.open("cover-tone.ogg").use { input ->
                file.outputStream().use { input.copyTo(it) }
            }
            val cover = instrumentation.context.assets.open("cover-pixel.png").use { it.readBytes() }
            block(file, cover)
        } finally { dir.deleteRecursively() }
    }

    /** Hash actual extractor audio packets and timestamps, rather than the changed container bytes. */
    private fun audioHash(file: File): String {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.path)
            val track = (0 until extractor.trackCount).first {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
            assertEquals("audio/vorbis", extractor.getTrackFormat(track).getString(MediaFormat.KEY_MIME))
            extractor.selectTrack(track)
            val hash = MessageDigest.getInstance("SHA-256")
            val buffer = ByteBuffer.allocate(1024 * 1024)
            var samples = 0
            while (true) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                hash.update(ByteBuffer.allocate(8).putLong(extractor.sampleTime).array())
                hash.update(buffer.array(), 0, size)
                samples++
                extractor.advance()
            }
            assertTrue("missing audio samples", samples > 10)
            return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        } finally { extractor.release() }
    }

    @Test fun embedsThePictureWithoutChangingVorbisAudioPackets() = withTrack { file, cover ->
        val before = audioHash(file)
        assertTrue(OggCoverWriter.writeCover(file.path, cover, "image/png", 1, 1, 24))
        val after = audioHash(file)
        assertEquals(before, after)
        val metadata = String(file.readBytes(), Charsets.ISO_8859_1)
        assertTrue(metadata.contains("TITLE=Cover regression tone", ignoreCase = true))
        assertTrue(metadata.contains("ARTIST=MusicFree tests", ignoreCase = true))
        assertTrue(metadata.contains("METADATA_BLOCK_PICTURE="))
        val encoded = Regex("METADATA_BLOCK_PICTURE=([A-Za-z0-9+/=]+)").find(metadata)
        assertNotNull("missing picture comment", encoded)
        val picture = Base64.decode(encoded!!.groupValues[1], Base64.NO_WRAP)
        // The picture block ends with the unmodified image payload.
        assertArrayEquals(cover, picture.copyOfRange(picture.size - cover.size, picture.size))
        println("OGG_COVER_EVIDENCE audio_before=$before audio_after=$after")
    }

    @Test fun aTruncatedPageFailsWithoutChangingTheOriginal() = withTrack { file, cover ->
        file.writeBytes(file.readBytes().dropLast(1).toByteArray())
        val original = file.readBytes()
        assertFalse(OggCoverWriter.writeCover(file.path, cover, "image/png", 1, 1, 24))
        assertArrayEquals(original, file.readBytes())
        assertFalse(File("${file.path}.tmp_cover").exists())
    }

    @Test fun aCompleteTrackKeepsItsTrailingTagsWhenTheCoverIsWritten() = withTrack { file, cover ->
        val original = file.readBytes()
        val before = audioHash(file)
        val id3 = "TAG".toByteArray() + ByteArray(125)
        val ape = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
            .put("APETAGEX".toByteArray()).putInt(2000).putInt(32).putInt(0).putInt(0).putLong(0).array()
        for (tail in listOf(id3, ape, ape + id3)) {
            file.writeBytes(original + tail)
            assertTrue(OggCoverWriter.writeCover(file.path, cover, "image/png", 1, 1, 24))
            val written = file.readBytes()
            assertArrayEquals(tail, written.copyOfRange(written.size - tail.size, written.size))
            assertTrue(String(written, Charsets.ISO_8859_1).contains("METADATA_BLOCK_PICTURE="))
            // Check actual Vorbis packets/timestamps independently of a platform's trailer handling.
            // Full-file decoding with these trailers is also checked using ffmpeg on the host.
            file.writeBytes(written.copyOf(written.size - tail.size))
            assertEquals(before, audioHash(file))
        }
    }
}
