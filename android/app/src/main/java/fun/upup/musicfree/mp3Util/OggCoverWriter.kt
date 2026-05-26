package `fun`.upup.musicfree.mp3Util

import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

object OggCoverWriter {
    private const val TAG = "OggCoverWriter"
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

    fun writeCover(
        oggFilePath: String,
        coverBytes: ByteArray,
        mimeType: String,
        imageWidth: Int,
        imageHeight: Int,
        colourDepth: Int,
    ): Boolean {
        return try {
            val file = File(oggFilePath)
            if (!file.exists() || !file.isFile) {
                Log.e(TAG, "File does not exist: $oggFilePath")
                return false
            }

            val raw = file.readBytes()
            val pages = parsePages(raw)
            if (pages.isEmpty()) {
                Log.e(TAG, "No OGG pages found")
                return false
            }

            val serialNumber = pages[0].serialNumber
            val (packets, packetPageRanges) = reassembleHeaderPackets(pages)
            if (packets.size < 3) {
                Log.e(TAG, "Could not find Vorbis header packets")
                return false
            }
            if (!isVorbisPacket(packets[0], 0x01) ||
                !isVorbisPacket(packets[1], 0x03) ||
                !isVorbisPacket(packets[2], 0x05)
            ) {
                Log.e(TAG, "Invalid Vorbis header packets")
                return false
            }

            val newCommentPacket = rebuildCommentPacket(
                packets[1],
                coverBytes,
                mimeType,
                imageWidth,
                imageHeight,
                colourDepth,
            ) ?: return false

            val firstAudioPageIndex = packetPageRanges[2].last + 1
            val output = ByteArrayOutputStream(raw.size + coverBytes.size + 4096)

            output.write(pages[0].toBytes())
            var nextSequence = 1
            val headerPages = paginatePackets(
                listOf(newCommentPacket, packets[2]),
                serialNumber = serialNumber,
                startSequence = nextSequence,
                granulePosition = 0L,
            )
            for (page in headerPages) {
                output.write(page.toBytes())
            }
            nextSequence += headerPages.size

            for (i in firstAudioPageIndex until pages.size) {
                val original = pages[i]
                output.write(
                    OggPage(
                        version = original.version,
                        headerType = original.headerType,
                        granulePosition = original.granulePosition,
                        serialNumber = original.serialNumber,
                        pageSequenceNumber = nextSequence,
                        segmentTable = original.segmentTable,
                        body = original.body,
                    ).toBytes(),
                )
                nextSequence++
            }

            val tempFile = File("$oggFilePath.tmp_cover")
            try {
                tempFile.writeBytes(output.toByteArray())
                if (!tempFile.renameTo(file)) {
                    tempFile.inputStream().use { input ->
                        file.outputStream().use { out -> input.copyTo(out) }
                    }
                    tempFile.delete()
                }
            } catch (error: Exception) {
                tempFile.delete()
                throw error
            }

            true
        } catch (error: Exception) {
            Log.e(TAG, "Failed to write OGG cover: ${error.message}", error)
            false
        }
    }

    private fun parsePages(data: ByteArray): List<OggPage> {
        val pages = mutableListOf<OggPage>()
        var offset = 0

        while (offset + OGG_HEADER_SIZE <= data.size) {
            if (data[offset] != 'O'.code.toByte() ||
                data[offset + 1] != 'g'.code.toByte() ||
                data[offset + 2] != 'g'.code.toByte() ||
                data[offset + 3] != 'S'.code.toByte()
            ) {
                Log.e(TAG, "Invalid capture pattern at offset $offset")
                return pages
            }

            val version = data[offset + 4].toInt() and 0xFF
            val headerType = data[offset + 5].toInt() and 0xFF
            val granulePosition = readLittleEndianLong(data, offset + 6)
            val serialNumber = readLittleEndianInt(data, offset + 14)
            val pageSequenceNumber = readLittleEndianInt(data, offset + 18)
            val segmentCount = data[offset + 26].toInt() and 0xFF
            if (offset + OGG_HEADER_SIZE + segmentCount > data.size) {
                Log.e(TAG, "Truncated segment table at offset $offset")
                return pages
            }

            val segmentTable = data.copyOfRange(
                offset + OGG_HEADER_SIZE,
                offset + OGG_HEADER_SIZE + segmentCount,
            )
            val bodySize = segmentTable.sumOf { it.toInt() and 0xFF }
            val bodyStart = offset + OGG_HEADER_SIZE + segmentCount
            if (bodyStart + bodySize > data.size) {
                Log.e(TAG, "Truncated page body at offset $offset")
                return pages
            }

            pages.add(
                OggPage(
                    version = version,
                    headerType = headerType,
                    granulePosition = granulePosition,
                    serialNumber = serialNumber,
                    pageSequenceNumber = pageSequenceNumber,
                    segmentTable = segmentTable,
                    body = data.copyOfRange(bodyStart, bodyStart + bodySize),
                ),
            )
            offset = bodyStart + bodySize
        }

        return pages
    }

    private fun reassembleHeaderPackets(
        pages: List<OggPage>,
    ): Pair<List<ByteArray>, List<IntRange>> {
        val packets = mutableListOf<ByteArray>()
        val pageRanges = mutableListOf<IntRange>()
        var currentPacket = ByteArrayOutputStream()
        var packetStartPage = 0

        for (pageIndex in pages.indices) {
            val page = pages[pageIndex]
            var bodyOffset = 0
            for (segment in page.segmentTable) {
                val segmentSize = segment.toInt() and 0xFF
                currentPacket.write(page.body, bodyOffset, segmentSize)
                bodyOffset += segmentSize

                if (segmentSize < SEGMENT_MAX) {
                    packets.add(currentPacket.toByteArray())
                    pageRanges.add(packetStartPage..pageIndex)
                    currentPacket = ByteArrayOutputStream()
                    packetStartPage = pageIndex
                    if (packets.size >= 3) {
                        return Pair(packets, pageRanges)
                    }
                }
            }
        }

        if (currentPacket.size() > 0) {
            packets.add(currentPacket.toByteArray())
            pageRanges.add(packetStartPage until pages.size)
        }
        return Pair(packets, pageRanges)
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
        coverBytes: ByteArray,
        mimeType: String,
        imageWidth: Int,
        imageHeight: Int,
        colourDepth: Int,
    ): ByteArray? {
        return try {
            val input = ByteBuffer.wrap(original).order(ByteOrder.LITTLE_ENDIAN)
            input.position(7)

            val vendorLength = input.int
            if (vendorLength < 0 || input.remaining() < vendorLength) {
                Log.e(TAG, "Invalid vendor length: $vendorLength")
                return null
            }
            val vendorBytes = ByteArray(vendorLength)
            input.get(vendorBytes)

            val commentCount = input.int
            if (commentCount < 0) {
                Log.e(TAG, "Invalid comment count: $commentCount")
                return null
            }

            val comments = mutableListOf<ByteArray>()
            for (i in 0 until commentCount) {
                if (input.remaining() < 4) {
                    Log.e(TAG, "Truncated comment length at index $i")
                    return null
                }
                val commentLength = input.int
                if (commentLength < 0 || input.remaining() < commentLength) {
                    Log.e(TAG, "Invalid comment length at index $i")
                    return null
                }
                val commentBytes = ByteArray(commentLength)
                input.get(commentBytes)
                val comment = String(commentBytes, Charsets.UTF_8)
                if (!comment.uppercase().startsWith("METADATA_BLOCK_PICTURE=")) {
                    comments.add(commentBytes)
                }
            }

            val pictureBlock = buildMetadataBlockPicture(
                coverBytes,
                mimeType,
                imageWidth,
                imageHeight,
                colourDepth,
            )
            val pictureBase64 = Base64.encodeToString(pictureBlock, Base64.NO_WRAP)
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
            Log.e(TAG, "Failed to rebuild Vorbis comment packet: ${error.message}", error)
            null
        }
    }

    private fun buildMetadataBlockPicture(
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
