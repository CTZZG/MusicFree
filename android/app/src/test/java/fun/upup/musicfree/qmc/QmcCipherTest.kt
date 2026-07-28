package `fun`.upup.musicfree.qmc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.MessageDigest

class QmcCipherTest {
    @Test
    fun staticCipherMatchesUnlockMusicKnownAnswers() {
        val beginning = ByteArray(16)
        QmcStaticCipher.decrypt(beginning, 0, beginning.size, 0L)
        assertArrayEquals(
            intArrayOf(
                0xC3, 0x4A, 0xD6, 0xCA, 0x90, 0x67, 0xF7, 0x52,
                0xD8, 0xA1, 0x66, 0x62, 0x9F, 0x5B, 0x09, 0x00,
            ).toByteArray(),
            beginning,
        )

        val boundary = ByteArray(16)
        QmcStaticCipher.decrypt(boundary, 0, boundary.size, 0x7ff8L)
        assertArrayEquals(
            intArrayOf(
                0xD8, 0x52, 0xF7, 0x67, 0x90, 0xCA, 0xD6, 0x4A,
                0x4A, 0xD6, 0xCA, 0x90, 0x67, 0xF7, 0x52, 0xD8,
            ).toByteArray(),
            boundary,
        )
    }

    @Test
    fun mapCipherMatchesUnlockMusicKnownAnswer() {
        val key = ByteArray(256) { it.toByte() }
        val output = ByteArray(16)
        QmcMapCipher(key).decrypt(output, 0, output.size, 0L)
        assertArrayEquals(
            intArrayOf(
                0xBB, 0x7D, 0x80, 0xBE, 0xFF, 0x38, 0x81, 0xFB,
                0xBB, 0xFF, 0x82, 0x3C, 0xFF, 0xBA, 0x83, 0x79,
            ).toByteArray(),
            output,
        )
    }

    @Test
    fun segmentedRc4MatchesIndependentReferenceAtFullAndRandomRanges() {
        val key = ByteArray(512) { index -> (((index * 73 + 19) % 251) + 1).toByte() }
        val full = ByteArray(11_000) { index -> (index * 31 + 7).toByte() }
        QmcRc4Cipher(key).decrypt(full, 0, full.size, 0L)
        assertEquals(
            "7fcc339a96d602096811d50814691312962ac27a798548851746fb5821916c26",
            full.sha256(),
        )

        val ranges = listOf(
            Triple(0, 128, "449e330d5af33660253fe78c546ddf3aa0353a0f36d53d50314cefcdbb1d1335"),
            Triple(128, 4_992, "eb28d43976557d226a4cc2f6bd45a451e8f0df5ad7fd7cf07b3b76090de10e63"),
            Triple(4_999, 333, "a5e958963124fad1fea3da86c4889acfd078bb128926c7b5339b7b028bea00d5"),
            Triple(5_120, 5_120, "97bc8eb584f2e85b5a641e6c5243d3a8045982b37f87c11aed275588ae033293"),
            Triple(10_123, 777, "89eeaab46c12262c3eca4c354c71da5df79a149b448276d1827f2c8bca6fb9be"),
        )
        for ((start, length, expectedHash) in ranges) {
            val range = ByteArray(length) { index -> ((start + index) * 31 + 7).toByte() }
            QmcRc4Cipher(key).decrypt(range, 0, range.size, start.toLong())
            assertEquals("range $start+$length", expectedHash, range.sha256())
        }
    }

    @Test
    fun allCiphersRejectNegativeAndOverflowingAbsoluteRanges() {
        val ciphers = listOf<QmcCipher>(
            QmcStaticCipher,
            QmcMapCipher(ByteArray(32) { (it + 1).toByte() }),
            QmcRc4Cipher(ByteArray(512) { (it % 251 + 1).toByte() }),
        )
        ciphers.forEach { cipher ->
            assertThrows(IllegalArgumentException::class.java) {
                cipher.decrypt(ByteArray(1), 0, 1, -1L)
            }
            assertThrows(IllegalArgumentException::class.java) {
                cipher.decrypt(ByteArray(1), 0, 1, Long.MAX_VALUE)
            }
        }
    }

    private fun ByteArray.sha256(): String = MessageDigest.getInstance("SHA-256")
        .digest(this)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun IntArray.toByteArray() = ByteArray(size) { this[it].toByte() }
}
