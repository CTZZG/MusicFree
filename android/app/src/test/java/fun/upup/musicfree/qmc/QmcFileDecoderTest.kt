package `fun`.upup.musicfree.qmc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class QmcFileDecoderTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun replacesAnExistingOutputOnlyAfterSuccessfulDecryption() {
        val (input, expected) = createStaticQmcFile("track.qmcflac")
        val output = temporaryFolder.newFile("track.flac").apply {
            writeText("old output")
        }

        val info = QmcFileDecoder.decrypt(input.path, output.path, null)

        assertEquals("flac", info.extension)
        assertArrayEquals(expected, output.readBytes())
        assertFalse(java.io.File(output.path + QMC_OUTPUT_TEMP_SUFFIX).exists())
        assertFalse(java.io.File(output.path + QMC_OUTPUT_BACKUP_SUFFIX).exists())
    }

    @Test
    fun recoversDeterministicArtifactsFromAnInterruptedReplacement() {
        val (input, expected) = createStaticQmcFile("interrupted.qmcflac")
        val output = java.io.File(temporaryFolder.root, "interrupted.flac")
        val temp = java.io.File(output.path + QMC_OUTPUT_TEMP_SUFFIX).apply {
            writeText("partial replacement")
        }
        val backup = java.io.File(output.path + QMC_OUTPUT_BACKUP_SUFFIX).apply {
            writeText("previous output")
        }

        val info = QmcFileDecoder.decrypt(input.path, output.path, null)

        assertEquals("flac", info.extension)
        assertArrayEquals(expected, output.readBytes())
        assertFalse(temp.exists())
        assertFalse(backup.exists())
    }

    @Test
    fun keepsAnExistingOutputWhenDiscoveryFails() {
        val input = temporaryFolder.newFile("invalid.mflac").apply {
            writeBytes("bad!".toByteArray(Charsets.US_ASCII))
        }
        val original = "existing output".toByteArray(Charsets.US_ASCII)
        val output = temporaryFolder.newFile("track.flac").apply {
            writeBytes(original)
        }

        assertThrows(IllegalArgumentException::class.java) {
            QmcFileDecoder.decrypt(input.path, output.path, null)
        }
        assertArrayEquals(original, output.readBytes())
    }

    private fun createStaticQmcFile(name: String): Pair<java.io.File, ByteArray> {
        val plain = ByteArray(1_024) { index -> (index * 29 + 7).toByte() }
        "fLaC".toByteArray(Charsets.US_ASCII).copyInto(plain)
        val encrypted = plain.copyOf()
        QmcStaticCipher.decrypt(encrypted, 0, encrypted.size, 0L)
        repeat(4) { encrypted[encrypted.lastIndex - it] = 0xff.toByte() }
        val expected = encrypted.copyOf().also {
            QmcStaticCipher.decrypt(it, 0, it.size, 0L)
        }
        val input = temporaryFolder.newFile(name).apply {
            writeBytes(encrypted)
        }
        return input to expected
    }
}
