package `fun`.upup.musicfree.qmc

internal interface QmcRandomAccessSource {
    val size: Long

    fun readAt(offset: Long, length: Int): ByteArray
}

internal data class QmcStreamInfo(
    val audioSize: Long,
    val extension: String,
    val contentType: String,
)

internal enum class QmcFooterKind {
    EMBEDDED_KEY,
    QTAG,
    STAG,
    MUSIC_EX,
    STATIC,
}

internal class QmcDecoder private constructor(
    val info: QmcStreamInfo,
    val footerKind: QmcFooterKind,
    private val cipher: QmcCipher,
) {
    fun decrypt(
        buffer: ByteArray,
        bufferOffset: Int,
        length: Int,
        absoluteOffset: Long,
    ) = cipher.decrypt(buffer, bufferOffset, length, absoluteOffset)

    companion object {
        private const val HEADER_PROBE_LENGTH = 64
        private const val MAX_FOOTER_LENGTH = 64 * 1024
        private const val MAX_MUSIC_EX_LENGTH = 1024 * 1024

        fun discover(
            source: QmcRandomAccessSource,
            externalEkey: String?,
        ): QmcDecoder {
            require(source.size >= 4L) { "QMC source is empty or truncated" }
            val footer = inspectFooter(source)
            require(footer.audioSize >= 4L) { "QMC audio payload is empty or truncated" }

            val normalizedExternalKey = externalEkey?.trim()?.takeIf { it.isNotEmpty() }
            if (normalizedExternalKey != null) {
                require(normalizedExternalKey.length <= QmcKeyDeriver.MAX_ENCODED_KEY_LENGTH) {
                    "QMC external ekey is too large"
                }
            }
            val encodedKey = normalizedExternalKey?.toByteArray(Charsets.US_ASCII)
                ?: footer.embeddedEkey
            if (encodedKey == null && footer.requiresExternalKey) {
                throw IllegalArgumentException(
                    when (footer.kind) {
                        QmcFooterKind.STAG -> "QMC STag source requires an external ekey"
                        QmcFooterKind.MUSIC_EX -> "QMC musicex source requires an external ekey"
                        else -> "QMC source requires an external ekey"
                    },
                )
            }
            val decodedKey = encodedKey?.let(QmcKeyDeriver::derive)
            val cipher = QmcCipherFactory.create(decodedKey)
            val probeLength = minOf(HEADER_PROBE_LENGTH.toLong(), footer.audioSize).toInt()
            val header = source.readAt(0L, probeLength)
            require(header.size == probeLength) { "QMC source header is truncated" }
            cipher.decrypt(header, 0, header.size, 0L)
            val mediaType = sniffMediaType(header)
                ?: throw IllegalArgumentException(
                    "QMC key validation failed: decrypted audio format is unknown",
                )
            return QmcDecoder(
                info = QmcStreamInfo(
                    audioSize = footer.audioSize,
                    extension = mediaType.extension,
                    contentType = mediaType.contentType,
                ),
                footerKind = footer.kind,
                cipher = cipher,
            )
        }

        private fun inspectFooter(source: QmcRandomAccessSource): Footer {
            val lastFour = source.readAt(source.size - 4L, 4)
            require(lastFour.size == 4) { "QMC footer is truncated" }
            return when (lastFour.toString(Charsets.ISO_8859_1)) {
                "QTag" -> inspectQTag(source)
                "STag" -> Footer(
                    audioSize = source.size - 4L,
                    embeddedEkey = null,
                    requiresExternalKey = true,
                    kind = QmcFooterKind.STAG,
                )
                "cex\u0000" -> inspectMusicEx(source)
                else -> inspectLengthFooterOrStatic(source, lastFour)
            }
        }

        private fun inspectQTag(source: QmcRandomAccessSource): Footer {
            require(source.size >= 8L) { "QMC QTag footer is truncated" }
            val lengthBytes = source.readAt(source.size - 8L, 4)
            val metadataLength = readUInt32BigEndian(lengthBytes).toLong()
            require(metadataLength in 1L..MAX_FOOTER_LENGTH.toLong()) {
                "QMC QTag metadata length is invalid"
            }
            val audioSize = source.size - metadataLength - 8L
            require(audioSize > 0L) { "QMC QTag metadata exceeds the source size" }
            val metadata = source.readAt(audioSize, metadataLength.toInt())
            val separator = metadata.indexOf(','.code.toByte())
            require(separator > 0) { "QMC QTag does not contain an embedded ekey" }
            return Footer(
                audioSize = audioSize,
                embeddedEkey = metadata.copyOfRange(0, separator),
                requiresExternalKey = false,
                kind = QmcFooterKind.QTAG,
            )
        }

        private fun inspectMusicEx(source: QmcRandomAccessSource): Footer {
            require(source.size >= 16L) { "QMC musicex footer is truncated" }
            val trailer = source.readAt(source.size - 16L, 16)
            val tagSize = readUInt32LittleEndian(trailer, 0).toLong()
            val tagVersion = readUInt32LittleEndian(trailer, 4)
            val magic = trailer.copyOfRange(8, 16).toString(Charsets.ISO_8859_1)
            require(magic == "musicex\u0000") { "QMC musicex magic is invalid" }
            require(tagVersion == 1L) { "Unsupported QMC musicex version: $tagVersion" }
            require(tagSize in 0xC0L..MAX_MUSIC_EX_LENGTH.toLong()) {
                "QMC musicex tag length is invalid"
            }
            require(tagSize < source.size) { "QMC musicex tag exceeds the source size" }
            return Footer(
                audioSize = source.size - tagSize,
                embeddedEkey = null,
                requiresExternalKey = true,
                kind = QmcFooterKind.MUSIC_EX,
            )
        }

        private fun inspectLengthFooterOrStatic(
            source: QmcRandomAccessSource,
            lastFour: ByteArray,
        ): Footer {
            val keyLength = readUInt32LittleEndian(lastFour, 0)
            if (keyLength in 1L..MAX_FOOTER_LENGTH.toLong() && keyLength + 4L < source.size) {
                val audioSize = source.size - keyLength - 4L
                val encodedKey = source.readAt(audioSize, keyLength.toInt()).trimTrailingNuls()
                // The legacy footer has no magic. Treat it as an embedded-key footer only
                // when the candidate is actually derivable; otherwise ordinary static-QMC
                // payload bytes that happen to end in a small integer would be misclassified.
                if (
                    encodedKey.isNotEmpty() &&
                    runCatching { QmcKeyDeriver.derive(encodedKey) }.isSuccess
                ) {
                    return Footer(
                        audioSize = audioSize,
                        embeddedEkey = encodedKey,
                        requiresExternalKey = false,
                        kind = QmcFooterKind.EMBEDDED_KEY,
                    )
                }
            }
            return Footer(
                audioSize = source.size,
                embeddedEkey = null,
                requiresExternalKey = false,
                kind = QmcFooterKind.STATIC,
            )
        }

        private fun sniffMediaType(header: ByteArray): MediaType? = when {
            header.startsWithAscii("fLaC") -> MediaType("flac", "audio/flac")
            header.startsWithAscii("OggS") -> MediaType("ogg", "audio/ogg")
            header.startsWithAscii("ID3") || header.hasMp3FrameSync() ->
                MediaType("mp3", "audio/mpeg")
            header.size >= 12 && header.copyOfRange(4, 8).startsWithAscii("ftyp") ->
                MediaType("m4a", "audio/mp4")
            header.startsWithAscii("RIFF") &&
                header.size >= 12 &&
                header.copyOfRange(8, 12).startsWithAscii("WAVE") ->
                MediaType("wav", "audio/wav")
            else -> null
        }

        private fun ByteArray.hasMp3FrameSync(): Boolean =
            size >= 2 &&
                (this[0].toInt() and 0xff) == 0xff &&
                (this[1].toInt() and 0xe0) == 0xe0

        private fun ByteArray.startsWithAscii(value: String): Boolean {
            val expected = value.toByteArray(Charsets.US_ASCII)
            return size >= expected.size && expected.indices.all { this[it] == expected[it] }
        }

        private fun ByteArray.trimTrailingNuls(): ByteArray {
            var length = size
            while (length > 0 && this[length - 1] == 0.toByte()) length--
            return copyOf(length)
        }

        private fun readUInt32BigEndian(bytes: ByteArray): Long {
            require(bytes.size >= 4)
            return ((bytes[0].toLong() and 0xffL) shl 24) or
                ((bytes[1].toLong() and 0xffL) shl 16) or
                ((bytes[2].toLong() and 0xffL) shl 8) or
                (bytes[3].toLong() and 0xffL)
        }

        private fun readUInt32LittleEndian(bytes: ByteArray, offset: Int): Long {
            require(offset >= 0 && offset <= bytes.size - 4)
            return (bytes[offset].toLong() and 0xffL) or
                ((bytes[offset + 1].toLong() and 0xffL) shl 8) or
                ((bytes[offset + 2].toLong() and 0xffL) shl 16) or
                ((bytes[offset + 3].toLong() and 0xffL) shl 24)
        }
    }

    private data class Footer(
        val audioSize: Long,
        val embeddedEkey: ByteArray?,
        val requiresExternalKey: Boolean,
        val kind: QmcFooterKind,
    )

    private data class MediaType(
        val extension: String,
        val contentType: String,
    )
}
