package `fun`.upup.musicfree.qmc

import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.tan

/**
 * QMC key derivation adapted from unlock-music/cli (MIT).
 */
internal object QmcKeyDeriver {
    const val MAX_ENCODED_KEY_LENGTH = 64 * 1024

    private val encV2Prefix = "QQMusic EncV2,Key:".toByteArray(Charsets.US_ASCII)
    private val encV2Key1 = byteArrayOf(
        0x33, 0x38, 0x36, 0x5A, 0x4A, 0x59, 0x21, 0x40,
        0x23, 0x2A, 0x24, 0x25, 0x5E, 0x26, 0x29, 0x28,
    )
    private val encV2Key2 = byteArrayOf(
        0x2A, 0x2A, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
        0x26, 0x5E, 0x61, 0x31, 0x63, 0x5A, 0x2C, 0x54,
    )

    fun derive(encodedKey: String): ByteArray =
        derive(encodedKey.trim().toByteArray(Charsets.US_ASCII))

    fun derive(encodedKey: ByteArray): ByteArray {
        require(encodedKey.isNotEmpty()) { "QMC ekey must not be empty" }
        require(encodedKey.size <= MAX_ENCODED_KEY_LENGTH) { "QMC ekey is too large" }

        var decoded = decodeBase64(encodedKey)
        if (decoded.startsWith(encV2Prefix)) {
            val encryptedV2 = decoded.copyOfRange(encV2Prefix.size, decoded.size)
            val firstPass = decryptTencentTea(encryptedV2, encV2Key1)
            val secondPass = decryptTencentTea(firstPass, encV2Key2)
            decoded = decodeBase64(secondPass)
            require(decoded.size >= 16) { "QMC EncV2 key is too short" }
        }
        return deriveV1(decoded)
    }

    internal fun simpleMakeKey(salt: Int, length: Int): ByteArray {
        require(salt in 0..255 && length >= 0)
        return ByteArray(length) { index ->
            (abs(tan(salt.toDouble() + index * 0.1)) * 100.0).toInt().toByte()
        }
    }

    private fun deriveV1(decoded: ByteArray): ByteArray {
        require(decoded.size >= 16) { "QMC key is too short" }
        val simpleKey = simpleMakeKey(106, 8)
        val teaKey = ByteArray(16)
        repeat(8) { index ->
            teaKey[index shl 1] = simpleKey[index]
            teaKey[(index shl 1) + 1] = decoded[index]
        }
        val body = decryptTencentTea(decoded.copyOfRange(8, decoded.size), teaKey)
        return decoded.copyOfRange(0, 8) + body
    }

    private fun decryptTencentTea(input: ByteArray, key: ByteArray): ByteArray {
        require(input.size % TeaCipher.BLOCK_SIZE == 0) {
            "QMC TEA input size is not a multiple of the block size"
        }
        require(input.size >= TeaCipher.BLOCK_SIZE * 2) { "QMC TEA input is too small" }
        val cipher = TeaCipher(key, 32)
        val temporary = cipher.decryptBlock(input, 0)
        val paddingLength = temporary[0].toInt() and 0x7
        val outputLength = input.size - 1 - paddingLength - SALT_LENGTH - ZERO_LENGTH
        require(outputLength >= 0) { "QMC TEA padding is invalid" }
        val output = ByteArray(outputLength)

        var previousIv = ByteArray(TeaCipher.BLOCK_SIZE)
        var currentIv = input.copyOfRange(0, TeaCipher.BLOCK_SIZE)
        var inputOffset = TeaCipher.BLOCK_SIZE
        var temporaryIndex = 1 + paddingLength

        fun decryptNextBlock() {
            require(inputOffset + TeaCipher.BLOCK_SIZE <= input.size) {
                "QMC TEA input ended before the final block"
            }
            previousIv = currentIv
            currentIv = input.copyOfRange(inputOffset, inputOffset + TeaCipher.BLOCK_SIZE)
            repeat(TeaCipher.BLOCK_SIZE) { index ->
                temporary[index] =
                    (temporary[index].toInt() xor currentIv[index].toInt()).toByte()
            }
            val decrypted = cipher.decryptBlock(temporary, 0)
            decrypted.copyInto(temporary)
            inputOffset += TeaCipher.BLOCK_SIZE
            temporaryIndex = 0
        }

        repeat(SALT_LENGTH) {
            if (temporaryIndex == TeaCipher.BLOCK_SIZE) decryptNextBlock()
            temporaryIndex++
        }

        repeat(outputLength) { outputIndex ->
            if (temporaryIndex == TeaCipher.BLOCK_SIZE) decryptNextBlock()
            output[outputIndex] = (
                temporary[temporaryIndex].toInt() xor
                    previousIv[temporaryIndex].toInt()
                ).toByte()
            temporaryIndex++
        }

        repeat(ZERO_LENGTH) {
            if (temporaryIndex == TeaCipher.BLOCK_SIZE) decryptNextBlock()
            require(temporary[temporaryIndex] == previousIv[temporaryIndex]) {
                "QMC TEA zero check failed"
            }
            temporaryIndex++
        }
        return output
    }

    private fun decodeBase64(input: ByteArray): ByteArray {
        val clean = buildString(input.size) {
            input.forEach { value ->
                val code = value.toInt() and 0xff
                when (code) {
                    ' '.code, '\t'.code, '\r'.code, '\n'.code -> Unit
                    in 0x21..0x7e -> append(code.toChar())
                    else -> throw IllegalArgumentException("QMC ekey contains non-ASCII data")
                }
            }
        }
        require(clean.isNotEmpty()) { "QMC ekey is empty after normalization" }
        require(clean.length % 4 != 1) { "QMC ekey has invalid Base64 length" }
        val padded = clean.padEnd((clean.length + 3) / 4 * 4, '=')
        val output = ByteArrayOutputStream(padded.length / 4 * 3)
        var index = 0
        while (index < padded.length) {
            val a = base64Value(padded[index])
            val b = base64Value(padded[index + 1])
            require(a >= 0 && b >= 0) { "QMC ekey has invalid Base64 padding" }
            val thirdChar = padded[index + 2]
            val fourthChar = padded[index + 3]
            val c = if (thirdChar == '=') 0 else base64Value(thirdChar)
            val d = if (fourthChar == '=') 0 else base64Value(fourthChar)
            require(c >= 0 && d >= 0) { "QMC ekey contains invalid Base64 characters" }
            require(thirdChar != '=' || fourthChar == '=') { "QMC ekey has invalid Base64 padding" }
            require(
                (thirdChar != '=' && fourthChar != '=') || index + 4 == padded.length,
            ) { "QMC ekey has Base64 padding before the end" }

            output.write((a shl 2) or (b ushr 4))
            if (thirdChar != '=') {
                output.write(((b and 0x0f) shl 4) or (c ushr 2))
            }
            if (fourthChar != '=') {
                output.write(((c and 0x03) shl 6) or d)
            }
            index += 4
        }
        return output.toByteArray()
    }

    private fun base64Value(value: Char): Int = when (value) {
        in 'A'..'Z' -> value.code - 'A'.code
        in 'a'..'z' -> value.code - 'a'.code + 26
        in '0'..'9' -> value.code - '0'.code + 52
        '+', '-' -> 62
        '/', '_' -> 63
        else -> -1
    }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
        size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private const val SALT_LENGTH = 2
    private const val ZERO_LENGTH = 7
}

private class TeaCipher(key: ByteArray, private val rounds: Int) {
    private val keyWords: IntArray

    init {
        require(key.size == KEY_SIZE) { "QMC TEA key must be 16 bytes" }
        require(rounds > 0 && rounds % 2 == 0) { "QMC TEA rounds must be positive and even" }
        keyWords = IntArray(4) { readIntBigEndian(key, it * 4) }
    }

    fun decryptBlock(input: ByteArray, offset: Int): ByteArray {
        require(offset >= 0 && offset <= input.size - BLOCK_SIZE) { "QMC TEA block is truncated" }
        var first = readIntBigEndian(input, offset)
        var second = readIntBigEndian(input, offset + 4)
        var sum = DELTA * (rounds / 2)
        repeat(rounds / 2) {
            second -= (
                ((first shl 4) + keyWords[2]) xor
                    (first + sum) xor
                    ((first ushr 5) + keyWords[3])
                )
            first -= (
                ((second shl 4) + keyWords[0]) xor
                    (second + sum) xor
                    ((second ushr 5) + keyWords[1])
                )
            sum -= DELTA
        }
        return ByteArray(BLOCK_SIZE).also { output ->
            writeIntBigEndian(output, 0, first)
            writeIntBigEndian(output, 4, second)
        }
    }

    companion object {
        const val BLOCK_SIZE = 8
        private const val KEY_SIZE = 16
        private val DELTA = 0x9e3779b9L.toInt()

        private fun readIntBigEndian(input: ByteArray, offset: Int): Int =
            ((input[offset].toInt() and 0xff) shl 24) or
                ((input[offset + 1].toInt() and 0xff) shl 16) or
                ((input[offset + 2].toInt() and 0xff) shl 8) or
                (input[offset + 3].toInt() and 0xff)

        private fun writeIntBigEndian(output: ByteArray, offset: Int, value: Int) {
            output[offset] = (value ushr 24).toByte()
            output[offset + 1] = (value ushr 16).toByte()
            output[offset + 2] = (value ushr 8).toByte()
            output[offset + 3] = value.toByte()
        }
    }
}
