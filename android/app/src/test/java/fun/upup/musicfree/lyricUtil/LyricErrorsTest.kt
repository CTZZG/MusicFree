package `fun`.upup.musicfree.lyricUtil

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.Deflater

class LyricErrorsTest {
    @Test fun onlyAMissingOverlayPermissionUsesThePermissionCode() {
        assertEquals("OVERLAY_PERMISSION", LyricErrors.code(OverlayPermissionException()))
        assertEquals(
            "OVERLAY_PERMISSION",
            LyricErrors.code(OverlayPermissionException(SecurityException("denied"))),
        )
        assertEquals("Exception", LyricErrors.code(IllegalArgumentException("View not attached")))
        assertEquals("Exception", LyricErrors.code(SecurityException("unwrapped")))
    }

    @Test fun zlibInflateRoundTripsValidDeflatedLyricPayload() {
        val original = "[00:01.00]Hello MusicFree\n[00:02.50]Line 2\n".toByteArray(StandardCharsets.UTF_8)
        val compressed = deflateBytes(original)
        assertArrayEquals(original, zlibInflateBytes(compressed))
    }

    @Test fun zlibInflateRejectsTruncatedStreamWithoutSpinning() {
        val original = "A".repeat(256).toByteArray(StandardCharsets.UTF_8)
        val compressed = deflateBytes(original)
        val truncated = compressed.copyOf(compressed.size / 2)
        val error = assertThrows(Exception::class.java) {
            zlibInflateBytes(truncated)
        }
        assertTrue(error.message?.contains("Truncated") == true)
    }

    @Test fun zlibInflateRejectsPresetDictionaryStream() {
        val dict = "preset-dict-bytes".toByteArray(StandardCharsets.UTF_8)
        val original = "preset-dict-bytes hello".toByteArray(StandardCharsets.UTF_8)
        val compressed = deflateBytes(original, dictionary = dict)
        val error = assertThrows(Exception::class.java) {
            zlibInflateBytes(compressed)
        }
        assertTrue(error.message?.contains("dictionary") == true)
    }

    @Test fun zlibInflateRejectsDecompressionExceedingMaxOutputBytes() {
        val original = ByteArray(32 * 1024) { 'L'.code.toByte() }
        val compressed = deflateBytes(original)
        val error = assertThrows(Exception::class.java) {
            zlibInflateBytes(compressed, maxOutputBytes = 1024)
        }
        assertTrue(error.message?.contains("limit") == true)
    }

    private fun deflateBytes(input: ByteArray, dictionary: ByteArray? = null): ByteArray {
        val deflater = Deflater()
        return try {
            if (dictionary != null) {
                deflater.setDictionary(dictionary)
            }
            deflater.setInput(input)
            deflater.finish()
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(1024)
            while (!deflater.finished()) {
                val n = deflater.deflate(buffer)
                if (n > 0) out.write(buffer, 0, n) else break
            }
            out.toByteArray()
        } finally {
            deflater.end()
        }
    }
}
