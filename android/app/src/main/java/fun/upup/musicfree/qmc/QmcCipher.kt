package `fun`.upup.musicfree.qmc

/**
 * QMC compatibility ciphers adapted from unlock-music/cli (MIT).
 *
 * Every implementation is deterministic for an absolute audio byte offset.
 * This is required for HTTP Range playback and concurrent seek requests.
 */
internal interface QmcCipher {
    fun decrypt(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    )
}

internal object QmcCipherFactory {
    fun create(decodedKey: ByteArray?): QmcCipher = when {
        decodedKey == null || decodedKey.isEmpty() -> QmcStaticCipher
        decodedKey.size > 300 -> QmcRc4Cipher(decodedKey)
        else -> QmcMapCipher(decodedKey)
    }
}

internal object QmcStaticCipher : QmcCipher {
    override fun decrypt(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) {
        requireDecryptRange(buffer, bufferOffset, length, absoluteOffset)
        repeat(length) { index ->
            val offset = normalizeMaskOffset(absoluteOffset + index)
            val maskIndex = ((offset * offset + 27L) and 0xffL).toInt()
            buffer[bufferOffset + index] =
                (buffer[bufferOffset + index].toInt() xor STATIC_CIPHER_BOX[maskIndex]).toByte()
        }
    }

    private val STATIC_CIPHER_BOX = intArrayOf(
        0x77, 0x48, 0x32, 0x73, 0xDE, 0xF2, 0xC0, 0xC8,
        0x95, 0xEC, 0x30, 0xB2, 0x51, 0xC3, 0xE1, 0xA0,
        0x9E, 0xE6, 0x9D, 0xCF, 0xFA, 0x7F, 0x14, 0xD1,
        0xCE, 0xB8, 0xDC, 0xC3, 0x4A, 0x67, 0x93, 0xD6,
        0x28, 0xC2, 0x91, 0x70, 0xCA, 0x8D, 0xA2, 0xA4,
        0xF0, 0x08, 0x61, 0x90, 0x7E, 0x6F, 0xA2, 0xE0,
        0xEB, 0xAE, 0x3E, 0xB6, 0x67, 0xC7, 0x92, 0xF4,
        0x91, 0xB5, 0xF6, 0x6C, 0x5E, 0x84, 0x40, 0xF7,
        0xF3, 0x1B, 0x02, 0x7F, 0xD5, 0xAB, 0x41, 0x89,
        0x28, 0xF4, 0x25, 0xCC, 0x52, 0x11, 0xAD, 0x43,
        0x68, 0xA6, 0x41, 0x8B, 0x84, 0xB5, 0xFF, 0x2C,
        0x92, 0x4A, 0x26, 0xD8, 0x47, 0x6A, 0x7C, 0x95,
        0x61, 0xCC, 0xE6, 0xCB, 0xBB, 0x3F, 0x47, 0x58,
        0x89, 0x75, 0xC3, 0x75, 0xA1, 0xD9, 0xAF, 0xCC,
        0x08, 0x73, 0x17, 0xDC, 0xAA, 0x9A, 0xA2, 0x16,
        0x41, 0xD8, 0xA2, 0x06, 0xC6, 0x8B, 0xFC, 0x66,
        0x34, 0x9F, 0xCF, 0x18, 0x23, 0xA0, 0x0A, 0x74,
        0xE7, 0x2B, 0x27, 0x70, 0x92, 0xE9, 0xAF, 0x37,
        0xE6, 0x8C, 0xA7, 0xBC, 0x62, 0x65, 0x9C, 0xC2,
        0x08, 0xC9, 0x88, 0xB3, 0xF3, 0x43, 0xAC, 0x74,
        0x2C, 0x0F, 0xD4, 0xAF, 0xA1, 0xC3, 0x01, 0x64,
        0x95, 0x4E, 0x48, 0x9F, 0xF4, 0x35, 0x78, 0x95,
        0x7A, 0x39, 0xD6, 0x6A, 0xA0, 0x6D, 0x40, 0xE8,
        0x4F, 0xA8, 0xEF, 0x11, 0x1D, 0xF3, 0x1B, 0x3F,
        0x3F, 0x07, 0xDD, 0x6F, 0x5B, 0x19, 0x30, 0x19,
        0xFB, 0xEF, 0x0E, 0x37, 0xF0, 0x0E, 0xCD, 0x16,
        0x49, 0xFE, 0x53, 0x47, 0x13, 0x1A, 0xBD, 0xA4,
        0xF1, 0x40, 0x19, 0x60, 0x0E, 0xED, 0x68, 0x09,
        0x06, 0x5F, 0x4D, 0xCF, 0x3D, 0x1A, 0xFE, 0x20,
        0x77, 0xE4, 0xD9, 0xDA, 0xF9, 0xA4, 0x2B, 0x76,
        0x1C, 0x71, 0xDB, 0x00, 0xBC, 0xFD, 0x0C, 0x6C,
        0xA5, 0x47, 0xF7, 0xF6, 0x00, 0x79, 0x4A, 0x11,
    )
}

internal class QmcMapCipher(key: ByteArray) : QmcCipher {
    private val key = key.copyOf()

    init {
        require(this.key.isNotEmpty()) { "QMC map key must not be empty" }
    }

    override fun decrypt(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) {
        requireDecryptRange(buffer, bufferOffset, length, absoluteOffset)
        repeat(length) { index ->
            val offset = normalizeMaskOffset(absoluteOffset + index)
            val keyIndex = ((offset * offset + 71214L) % key.size).toInt()
            val rotate = ((keyIndex and 0x7) + 4) % 8
            val value = key[keyIndex].toInt() and 0xff
            val mask = ((value shl rotate) or (value ushr rotate)) and 0xff
            buffer[bufferOffset + index] =
                (buffer[bufferOffset + index].toInt() xor mask).toByte()
        }
    }
}

internal class QmcRc4Cipher(key: ByteArray) : QmcCipher {
    private val key = key.copyOf()
    private val keySize = key.size
    private val initialBox = ByteArray(keySize)
    private val hash: Long

    init {
        require(keySize > 300) { "QMC segmented RC4 key must be longer than 300 bytes" }
        repeat(keySize) { initialBox[it] = (it and 0xff).toByte() }
        var swapIndex = 0
        repeat(keySize) { index ->
            swapIndex = (
                swapIndex +
                    (initialBox[index].toInt() and 0xff) +
                    (this.key[index % keySize].toInt() and 0xff)
                ) % keySize
            val value = initialBox[index]
            initialBox[index] = initialBox[swapIndex]
            initialBox[swapIndex] = value
        }

        var nextHash = 1L
        for (valueByte in this.key) {
            val value = valueByte.toLong() and 0xffL
            if (value == 0L) continue
            val candidate = (nextHash * value) and 0xffffffffL
            if (candidate == 0L || candidate <= nextHash) break
            nextHash = candidate
        }
        hash = nextHash
    }

    override fun decrypt(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) {
        requireDecryptRange(buffer, bufferOffset, length, absoluteOffset)
        var remaining = length
        var processed = 0
        var sourceOffset = absoluteOffset

        if (sourceOffset < FIRST_SEGMENT_SIZE && remaining > 0) {
            val segmentLength = minOf(
                remaining.toLong(),
                FIRST_SEGMENT_SIZE - sourceOffset,
            ).toInt()
            decryptFirstSegment(
                buffer,
                bufferOffset,
                segmentLength,
                sourceOffset,
            )
            remaining -= segmentLength
            processed += segmentLength
            sourceOffset += segmentLength
        }

        if (remaining > 0 && sourceOffset % SEGMENT_SIZE != 0L) {
            val segmentLength = minOf(
                remaining.toLong(),
                SEGMENT_SIZE - sourceOffset % SEGMENT_SIZE,
            ).toInt()
            decryptSegment(
                buffer,
                bufferOffset + processed,
                segmentLength,
                sourceOffset,
            )
            remaining -= segmentLength
            processed += segmentLength
            sourceOffset += segmentLength
        }

        while (remaining.toLong() > SEGMENT_SIZE) {
            decryptSegment(
                buffer,
                bufferOffset + processed,
                SEGMENT_SIZE.toInt(),
                sourceOffset,
            )
            remaining -= SEGMENT_SIZE.toInt()
            processed += SEGMENT_SIZE.toInt()
            sourceOffset += SEGMENT_SIZE
        }

        if (remaining > 0) {
            decryptSegment(
                buffer,
                bufferOffset + processed,
                remaining,
                sourceOffset,
            )
        }
    }

    private fun decryptFirstSegment(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) {
        repeat(length) { index ->
            val keyIndex = segmentSkip(absoluteOffset + index)
            buffer[bufferOffset + index] = (
                buffer[bufferOffset + index].toInt() xor
                    (key[keyIndex].toInt() and 0xff)
                ).toByte()
        }
    }

    private fun decryptSegment(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) {
        val box = initialBox.copyOf()
        val skipLength = (
            absoluteOffset % SEGMENT_SIZE +
                segmentSkip(absoluteOffset / SEGMENT_SIZE)
            ).toInt()
        var firstIndex = 0
        var secondIndex = 0
        var streamIndex = -skipLength
        while (streamIndex < length) {
            firstIndex = (firstIndex + 1) % keySize
            secondIndex = (
                secondIndex + (box[firstIndex].toInt() and 0xff)
                ) % keySize
            val value = box[firstIndex]
            box[firstIndex] = box[secondIndex]
            box[secondIndex] = value
            if (streamIndex >= 0) {
                val maskIndex = (
                    (box[firstIndex].toInt() and 0xff) +
                        (box[secondIndex].toInt() and 0xff)
                    ) % keySize
                buffer[bufferOffset + streamIndex] = (
                    buffer[bufferOffset + streamIndex].toInt() xor
                        (box[maskIndex].toInt() and 0xff)
                    ).toByte()
            }
            streamIndex++
        }
    }

    private fun segmentSkip(id: Long): Int {
        val seed = key[(id % keySize).toInt()].toInt() and 0xff
        require(seed != 0) { "QMC segmented RC4 key contains an unusable zero seed" }
        val index = (hash.toDouble() / ((id + 1L) * seed).toDouble() * 100.0).toLong()
        return (index % keySize).toInt()
    }

    private companion object {
        const val FIRST_SEGMENT_SIZE = 128L
        const val SEGMENT_SIZE = 5120L
    }
}

private fun normalizeMaskOffset(offset: Long): Long =
    if (offset > 0x7fffL) offset % 0x7fffL else offset

private fun requireDecryptRange(
    buffer: ByteArray,
    offset: Int,
    length: Int,
    absoluteOffset: Long,
) {
    require(offset >= 0 && length >= 0 && offset <= buffer.size - length) {
        "QMC decrypt range is outside the destination buffer"
    }
    require(absoluteOffset >= 0L) { "QMC offset must not be negative" }
    require(absoluteOffset <= Long.MAX_VALUE - length.toLong()) {
        "QMC decrypt range overflows"
    }
}
