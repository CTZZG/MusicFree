package `fun`.upup.musicfree.mp3Util

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal object OggCoverRewriter {
    private const val OGG_HEADER_SIZE = 27
    private const val MAX_SEGMENTS_PER_PAGE = 255
    private const val SEGMENT_MAX = 255

    private val crcTable = IntArray(256).also { table ->
        for (i in 0 until 256) {
            var value = i shl 24
            for (j in 0 until 8) {
                value = if (value and 0x80000000.toInt() != 0) {
                    (value shl 1) xor 0x04C11DB7
                } else {
                    value shl 1
                }
            }
            table[i] = value
        }
    }

    private data class OggPage(
        val version: Int,
        val headerType: Int,
        val granulePosition: Long,
        val serialNumber: Int,
        val pageSequenceNumber: Int,
        val segmentTable: ByteArray,
        val body: ByteArray,
    ) {
        fun toBytes(): ByteArray {
            val size = OGG_HEADER_SIZE + segmentTable.size + body.size
            val buffer = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN)
            buffer.put("OggS".toByteArray(Charsets.US_ASCII))
            buffer.put(version.toByte())
            buffer.put(headerType.toByte())
            buffer.putLong(granulePosition)
            buffer.putInt(serialNumber)
            buffer.putInt(pageSequenceNumber)
            buffer.putInt(0)
            buffer.put(segmentTable.size.toByte())
            buffer.put(segmentTable)
            buffer.put(body)

            val bytes = buffer.array()
            val crc = oggCrc32(bytes)
            bytes[22] = (crc and 0xFF).toByte()
            bytes[23] = ((crc ushr 8) and 0xFF).toByte()
            bytes[24] = ((crc ushr 16) and 0xFF).toByte()
            bytes[25] = ((crc ushr 24) and 0xFF).toByte()
            return bytes
        }
    }

    // Audio pages stay bounded at 65,307 bytes; only the three codec headers are retained.
    private const val MAX_HEADER_BYTES = 16 * 1024 * 1024

    private data class Headers(
        val identificationPage: OggPage,
        val packets: List<ByteArray>,
        val audioRemainder: OggPage?,
    )

    fun writeCover(file: File, pictureBase64: String) {
        require(file.isFile) { "Missing Ogg file" }
        val temp = File("${file.path}.tmp_cover")
        try {
            DataInputStream(file.inputStream().buffered()).use { input ->
                val headers = readHeaders(input)
                val comment = rebuildCommentPacket(headers.packets[1], pictureBase64)
                    ?: throw IOException("Invalid Vorbis comment packet")
                val serial = headers.identificationPage.serialNumber
                temp.outputStream().buffered().use { output ->
                    output.write(headers.identificationPage.toBytes())
                    val replacements = paginatePackets(
                        listOf(comment, headers.packets[2]), serial, 1, 0L,
                    )
                    for (page in replacements) output.write(page.toBytes())
                    var nextSequence = 1 + replacements.size
                    fun writeAudio(page: OggPage) {
                        // Other logical/chained streams keep their own sequence numbers.
                        val written = if (page.serialNumber == serial) {
                            page.copy(pageSequenceNumber = nextSequence++)
                        } else {
                            page
                        }
                        output.write(written.toBytes())
                    }
                    headers.audioRemainder?.let { writeAudio(it) }
                    while (true) {
                        val page = readPage(input) ?: break
                        writeAudio(page)
                    }
                }
            }
            // A failed replace must leave the original untouched, not truncate it for a fallback copy.
            if (!temp.renameTo(file)) throw IOException("Unable to replace Ogg file")
        } finally {
            temp.delete()
        }
    }

    private fun readPage(input: DataInputStream): OggPage? {
        val first = input.read()
        if (first == -1) return null
        val header = ByteArray(OGG_HEADER_SIZE)
        header[0] = first.toByte()
        input.readFully(header, 1, OGG_HEADER_SIZE - 1)
        if (!header.copyOfRange(0, 4).contentEquals("OggS".toByteArray(Charsets.US_ASCII))) {
            throw IOException("Invalid Ogg capture pattern")
        }
        if (header[4].toInt() != 0) throw IOException("Unsupported Ogg page version")
        val segments = ByteArray(header[26].toInt() and 0xFF)
        input.readFully(segments)
        val body = ByteArray(segments.sumOf { it.toInt() and 0xFF })
        input.readFully(body)
        return OggPage(
            version = 0,
            headerType = header[5].toInt() and 0xFF,
            granulePosition = readLittleEndianLong(header, 6),
            serialNumber = readLittleEndianInt(header, 14),
            pageSequenceNumber = readLittleEndianInt(header, 18),
            segmentTable = segments,
            body = body,
        )
    }

    private fun readHeaders(input: DataInputStream): Headers {
        val identificationPage = readPage(input) ?: throw EOFException("No Ogg pages")
        val packets = mutableListOf<ByteArray>()
        var packet = ByteArrayOutputStream()
        var headerBytes = 0
        var page = identificationPage
        while (true) {
            if (page.serialNumber != identificationPage.serialNumber) {
                throw IOException("Interleaved streams in Vorbis headers")
            }
            var bodyOffset = 0
            for ((index, segment) in page.segmentTable.withIndex()) {
                val size = segment.toInt() and 0xFF
                headerBytes += size
                if (headerBytes > MAX_HEADER_BYTES) throw IOException("Vorbis headers exceed 16 MiB")
                packet.write(page.body, bodyOffset, size)
                bodyOffset += size
                if (size < SEGMENT_MAX) {
                    packets.add(packet.toByteArray())
                    packet = ByteArrayOutputStream()
                    // The Vorbis identification header must be alone on its first page.
                    if (packets.size == 1 && (page !== identificationPage || index != page.segmentTable.lastIndex)) {
                        throw IOException("Invalid Vorbis identification page")
                    }
                    if (packets.size == 3) {
                        if (!isVorbisPacket(packets[0], 0x01) ||
                            !isVorbisPacket(packets[1], 0x03) ||
                            !isVorbisPacket(packets[2], 0x05)
                        ) throw IOException("Invalid Vorbis headers")
                        val remainder = if (index < page.segmentTable.lastIndex) {
                            page.copy(
                                headerType = page.headerType and 0xFC,
                                segmentTable = page.segmentTable.copyOfRange(index + 1, page.segmentTable.size),
                                body = page.body.copyOfRange(bodyOffset, page.body.size),
                            )
                        } else null
                        return Headers(identificationPage, packets, remainder)
                    }
                }
            }
            page = readPage(input) ?: throw EOFException("Incomplete Vorbis headers")
        }
    }

    private fun isVorbisPacket(packet: ByteArray, expectedType: Int): Boolean {
        if (packet.size < 7) return false
        if ((packet[0].toInt() and 0xFF) != expectedType) return false
        val vorbis = "vorbis".toByteArray(Charsets.US_ASCII)
        for (i in vorbis.indices) {
            if (packet[1 + i] != vorbis[i]) return false
        }
        return true
    }

    private fun rebuildCommentPacket(
        original: ByteArray,
        pictureBase64: String,
    ): ByteArray? {
        return try {
            val input = ByteBuffer.wrap(original).order(ByteOrder.LITTLE_ENDIAN)
            input.position(7)

            val vendorLength = input.int
            if (vendorLength < 0 || input.remaining() < vendorLength) {
                return null
            }
            val vendorBytes = ByteArray(vendorLength)
            input.get(vendorBytes)

            val commentCount = input.int
            if (commentCount < 0) {
                return null
            }

            val comments = mutableListOf<ByteArray>()
            for (i in 0 until commentCount) {
                if (input.remaining() < 4) {
                    return null
                }
                val commentLength = input.int
                if (commentLength < 0 || input.remaining() < commentLength) {
                    return null
                }
                val commentBytes = ByteArray(commentLength)
                input.get(commentBytes)
                val comment = String(commentBytes, Charsets.UTF_8)
                if (!comment.uppercase().startsWith("METADATA_BLOCK_PICTURE=")) {
                    comments.add(commentBytes)
                }
            }

            comments.add("METADATA_BLOCK_PICTURE=$pictureBase64".toByteArray(Charsets.UTF_8))

            val output = ByteArrayOutputStream()
            output.write(0x03)
            output.write("vorbis".toByteArray(Charsets.US_ASCII))
            output.write(toLittleEndianInt(vendorLength))
            output.write(vendorBytes)
            output.write(toLittleEndianInt(comments.size))
            for (comment in comments) {
                output.write(toLittleEndianInt(comment.size))
                output.write(comment)
            }
            output.write(0x01)
            output.toByteArray()
        } catch (error: Exception) {
            null
        }
    }

    fun buildMetadataBlockPicture(
        coverBytes: ByteArray,
        mimeType: String,
        imageWidth: Int,
        imageHeight: Int,
        colourDepth: Int,
    ): ByteArray {
        val mimeBytes = mimeType.toByteArray(Charsets.US_ASCII)
        val buffer = ByteBuffer.allocate(
            4 +
                4 + mimeBytes.size +
                4 +
                4 +
                4 +
                4 +
                4 +
                4 + coverBytes.size,
        ).order(ByteOrder.BIG_ENDIAN)

        buffer.putInt(3)
        buffer.putInt(mimeBytes.size)
        buffer.put(mimeBytes)
        buffer.putInt(0)
        buffer.putInt(imageWidth)
        buffer.putInt(imageHeight)
        buffer.putInt(colourDepth)
        buffer.putInt(0)
        buffer.putInt(coverBytes.size)
        buffer.put(coverBytes)
        return buffer.array()
    }

    private fun paginatePackets(
        packets: List<ByteArray>,
        serialNumber: Int,
        startSequence: Int,
        granulePosition: Long,
    ): List<OggPage> {
        data class Segment(
            val data: ByteArray,
            val offset: Int,
            val length: Int,
        )

        val segments = mutableListOf<Segment>()
        for (packet in packets) {
            var position = 0
            while (position < packet.size) {
                val chunkSize = minOf(SEGMENT_MAX, packet.size - position)
                segments.add(Segment(packet, position, chunkSize))
                position += chunkSize
                if (position >= packet.size && chunkSize == SEGMENT_MAX) {
                    segments.add(Segment(ByteArray(0), 0, 0))
                }
            }
            if (packet.isEmpty()) {
                segments.add(Segment(ByteArray(0), 0, 0))
            }
        }

        val pages = mutableListOf<OggPage>()
        var segmentIndex = 0
        var sequence = startSequence
        var continuingPacket = false

        while (segmentIndex < segments.size) {
            val pageSegments = segments.subList(
                segmentIndex,
                minOf(segmentIndex + MAX_SEGMENTS_PER_PAGE, segments.size),
            )
            val segmentTable = ByteArray(pageSegments.size) { index ->
                pageSegments[index].length.toByte()
            }
            val body = ByteArrayOutputStream()
            for (segment in pageSegments) {
                if (segment.length > 0) {
                    body.write(segment.data, segment.offset, segment.length)
                }
            }

            pages.add(
                OggPage(
                    version = 0,
                    headerType = if (continuingPacket) 0x01 else 0x00,
                    granulePosition = granulePosition,
                    serialNumber = serialNumber,
                    pageSequenceNumber = sequence,
                    segmentTable = segmentTable,
                    body = body.toByteArray(),
                ),
            )

            continuingPacket = pageSegments.last().length == SEGMENT_MAX
            segmentIndex += pageSegments.size
            sequence++
        }

        return pages
    }

    private fun oggCrc32(data: ByteArray): Int {
        var crc = 0
        for (byte in data) {
            crc = (crc shl 8) xor crcTable[((crc ushr 24) and 0xFF) xor (byte.toInt() and 0xFF)]
        }
        return crc
    }

    private fun readLittleEndianInt(data: ByteArray, offset: Int): Int {
        return (data[offset].toInt() and 0xFF) or
            ((data[offset + 1].toInt() and 0xFF) shl 8) or
            ((data[offset + 2].toInt() and 0xFF) shl 16) or
            ((data[offset + 3].toInt() and 0xFF) shl 24)
    }

    private fun readLittleEndianLong(data: ByteArray, offset: Int): Long {
        var value = 0L
        for (i in 0 until 8) {
            value = value or ((data[offset + i].toLong() and 0xFF) shl (i * 8))
        }
        return value
    }

    private fun toLittleEndianInt(value: Int): ByteArray {
        return byteArrayOf(
            (value and 0xFF).toByte(),
            ((value ushr 8) and 0xFF).toByte(),
            ((value ushr 16) and 0xFF).toByte(),
            ((value ushr 24) and 0xFF).toByte(),
        )
    }
}
