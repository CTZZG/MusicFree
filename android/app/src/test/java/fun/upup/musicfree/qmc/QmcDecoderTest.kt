package `fun`.upup.musicfree.qmc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class QmcDecoderTest {
    @Test
    fun discoversEmbeddedKeyAndDecryptsArbitraryRange() {
        val fixture = fixtureWithLengthFooter()
        val decoder = QmcDecoder.discover(MemorySource(fixture.encryptedFile), null)
        assertEquals(QmcFooterKind.EMBEDDED_KEY, decoder.footerKind)
        assertEquals("flac", decoder.info.extension)
        assertEquals(fixture.plain.size.toLong(), decoder.info.audioSize)

        val start = 31
        val encryptedRange = fixture.encryptedFile.copyOfRange(start, start + 97)
        decoder.decrypt(encryptedRange, 0, encryptedRange.size, start.toLong())
        assertArrayEquals(fixture.plain.copyOfRange(start, start + 97), encryptedRange)
    }

    @Test
    fun externalKeyUnlocksSTagAndStripsItsFooter() {
        val fixture = fixtureWithLengthFooter()
        val encryptedAudio = fixture.encryptedFile.copyOfRange(0, fixture.plain.size)
        val file = encryptedAudio + "STag".toByteArray(Charsets.US_ASCII)
        val decoder = QmcDecoder.discover(MemorySource(file), fixture.encodedKey)
        assertEquals(QmcFooterKind.STAG, decoder.footerKind)
        assertEquals(fixture.plain.size.toLong(), decoder.info.audioSize)

        assertThrows(IllegalArgumentException::class.java) {
            QmcDecoder.discover(MemorySource(file), null)
        }
    }

    @Test
    fun parsesQTagAndMusicExFooterLengths() {
        val fixture = fixtureWithLengthFooter()
        val encryptedAudio = fixture.encryptedFile.copyOfRange(0, fixture.plain.size)
        val qtagMetadata = "${fixture.encodedKey},12345,2".toByteArray(Charsets.US_ASCII)
        val qtag = encryptedAudio + qtagMetadata +
            uint32BigEndian(qtagMetadata.size) + "QTag".toByteArray(Charsets.US_ASCII)
        val qtagDecoder = QmcDecoder.discover(MemorySource(qtag), null)
        assertEquals(QmcFooterKind.QTAG, qtagDecoder.footerKind)
        assertEquals(fixture.plain.size.toLong(), qtagDecoder.info.audioSize)

        val musicEx = ByteArray(0xC0)
        uint32LittleEndian(0xC0).copyInto(musicEx, musicEx.size - 16)
        uint32LittleEndian(1).copyInto(musicEx, musicEx.size - 12)
        "musicex\u0000".toByteArray(Charsets.ISO_8859_1).copyInto(musicEx, musicEx.size - 8)
        val musicExDecoder = QmcDecoder.discover(
            MemorySource(encryptedAudio + musicEx),
            fixture.encodedKey,
        )
        assertEquals(QmcFooterKind.MUSIC_EX, musicExDecoder.footerKind)
        assertEquals(fixture.plain.size.toLong(), musicExDecoder.info.audioSize)
    }

    @Test
    fun rejectsWrongExternalKeyBeforeCreatingAStream() {
        val fixture = fixtureWithLengthFooter()
        val encryptedAudio = fixture.encryptedFile.copyOfRange(0, fixture.plain.size)
        assertThrows(IllegalArgumentException::class.java) {
            QmcDecoder.discover(
                MemorySource(encryptedAudio + "STag".toByteArray()),
                "QUFBQUFBQUFBQUFBQUFBQQ==",
            )
        }
    }

    @Test
    fun staticCipherDoesNotMisclassifyAnAccidentalLengthFooter() {
        val plain = ByteArray(128) { index -> (index * 13 + 5).toByte() }
        "fLaC".toByteArray(Charsets.US_ASCII).copyInto(plain)
        val encrypted = plain.copyOf()
        QmcStaticCipher.decrypt(encrypted, 0, encrypted.size, 0L)
        encrypted[encrypted.lastIndex - 4] = 0
        uint32LittleEndian(1).copyInto(encrypted, encrypted.size - 4)

        val decoder = QmcDecoder.discover(MemorySource(encrypted), null)

        assertEquals(QmcFooterKind.STATIC, decoder.footerKind)
        assertEquals(encrypted.size.toLong(), decoder.info.audioSize)
        assertEquals("flac", decoder.info.extension)
    }

    private fun fixtureWithLengthFooter(): Fixture {
        val encodedKeyBytes = MFLAC_MAP_KEY_RAW.toByteArray(Charsets.US_ASCII)
        val decodedKey = QmcKeyDeriver.derive(encodedKeyBytes)
        val plain = ByteArray(1_024) { index -> (index * 17 + 3).toByte() }
        "fLaC".toByteArray(Charsets.US_ASCII).copyInto(plain)
        val encrypted = plain.copyOf()
        QmcMapCipher(decodedKey).decrypt(encrypted, 0, encrypted.size, 0L)
        return Fixture(
            plain = plain,
            encodedKey = encodedKeyBytes.toString(Charsets.US_ASCII),
            encryptedFile = encrypted + encodedKeyBytes + uint32LittleEndian(encodedKeyBytes.size),
        )
    }

    private fun uint32LittleEndian(value: Int) = byteArrayOf(
        value.toByte(),
        (value ushr 8).toByte(),
        (value ushr 16).toByte(),
        (value ushr 24).toByte(),
    )

    private fun uint32BigEndian(value: Int) = byteArrayOf(
        (value ushr 24).toByte(),
        (value ushr 16).toByte(),
        (value ushr 8).toByte(),
        value.toByte(),
    )

    private data class Fixture(
        val plain: ByteArray,
        val encodedKey: String,
        val encryptedFile: ByteArray,
    )

    private class MemorySource(
        private val data: ByteArray,
    ) : QmcRandomAccessSource {
        override val size: Long = data.size.toLong()

        override fun readAt(offset: Long, length: Int): ByteArray {
            require(offset >= 0L && length >= 0 && offset <= size - length)
            return data.copyOfRange(offset.toInt(), offset.toInt() + length)
        }
    }

    private companion object {
        const val MFLAC_MAP_KEY_RAW =
            "eXc3eFdPeU6+3f7GVeF35bMpIEIQj5JWOWt7G+jsR68Hx3BUFBavkTQ8dpPdP0XBIwPe+OfdsnTGVQqPyg3GCtQSrkgA0mwSQdr4DPzKLkEZFX+Cf1V6ChyipOuC6KT37eAxWMdV1UHf9/OCvydr1dc6SWK1ijRUcP6IAHQhiB+mZLay7XXrSPo32WjdBkn9c9sa2SLtI48atj5kfZ4oOq6QGeld2JA3Z+3wwCe6uTHthKaEHY8ufDYodEe3qqrjYpzkdx55pCtxCQa1JiNqFmJigWm4m3CDzhuJ7YqnjbD+mXxLi7BP1+z4L6nccE2h+DGHVqpGjR9+4LBpe4WHB4DrAzVp2qQRRQJxeHd1v88="
    }
}
