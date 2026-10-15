package `fun`.upup.musicfree.mp3Util

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Test

class OggCoverRewriterTest {
    private val serial = 12345
    private val identification = byteArrayOf(1) + "vorbis".toByteArray() + ByteArray(23)
    private val setup = byteArrayOf(5) + "vorbis".toByteArray() + byteArrayOf(42)

    private fun comment(vararg tags: String): ByteArray {
        val output = ByteArrayOutputStream()
        fun number(n: Int) { output.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array()) }
        output.write(byteArrayOf(3) + "vorbis".toByteArray())
        val vendor = "test-vendor".toByteArray()
        number(vendor.size)
        output.write(vendor)
        number(tags.size)
        for (tag in tags) {
            val bytes = tag.toByteArray()
            number(bytes.size)
            output.write(bytes)
        }
        output.write(1)
        return output.toByteArray()
    }

    private data class Page(val serial: Int, val sequence: Int, val granule: Long, val flags: Int, val laces: ByteArray, val body: ByteArray)

    private fun page(sequence: Int, granule: Long, flags: Int, vararg packets: ByteArray, stream: Int = serial): ByteArray {
        val laces = packets.flatMap { packet ->
            List(packet.size / 255) { 255.toByte() } + (packet.size % 255).toByte()
        }.toByteArray()
        return rawPage(Page(stream, sequence, granule, flags, laces, packets.fold(ByteArray(0)) { a, b -> a + b }))
    }

    private fun rawPage(page: Page): ByteArray {
        val bytes = ByteBuffer.allocate(27 + page.laces.size + page.body.size).order(ByteOrder.LITTLE_ENDIAN)
            .put("OggS".toByteArray()).put(0.toByte()).put(page.flags.toByte()).putLong(page.granule)
            .putInt(page.serial).putInt(page.sequence).putInt(0).put(page.laces.size.toByte())
            .put(page.laces).put(page.body).array()
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putInt(22, crc(bytes))
        return bytes
    }

    private fun crc(bytes: ByteArray): Int {
        var value = 0
        for (byte in bytes) {
            value = value xor ((byte.toInt() and 255) shl 24)
            repeat(8) { value = if (value < 0) (value shl 1) xor 0x04C11DB7 else value shl 1 }
        }
        return value
    }

    private fun pages(file: File): List<Page> = DataInputStream(file.inputStream()).use { input ->
        val result = mutableListOf<Page>()
        while (input.available() > 0) {
            val header = ByteArray(27).also { input.readFully(it) }
            assertEquals("OggS", String(header, 0, 4))
            val laces = ByteArray(header[26].toInt() and 255).also { input.readFully(it) }
            val body = ByteArray(laces.sumOf { it.toInt() and 255 }).also { input.readFully(it) }
            val h = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            val storedCrc = h.getInt(22)
            h.putInt(22, 0)
            assertEquals("page CRC", storedCrc, crc(header + laces + body))
            result.add(Page(h.getInt(14), h.getInt(18), h.getLong(6), header[5].toInt(), laces, body))
        }
        result
    }

    private fun packets(pages: List<Page>): List<ByteArray> {
        val result = mutableListOf<ByteArray>()
        var packet = ByteArrayOutputStream()
        for (page in pages) {
            var offset = 0
            for (lace in page.laces) {
                val size = lace.toInt() and 255
                packet.write(page.body, offset, size)
                offset += size
                if (size < 255) {
                    result.add(packet.toByteArray())
                    packet = ByteArrayOutputStream()
                }
            }
        }
        return result
    }

    private fun withFile(bytes: ByteArray, check: (File) -> Unit) {
        val dir = Files.createTempDirectory("ogg-cover-test").toFile()
        try {
            val file = File(dir, "track.ogg").apply { writeBytes(bytes) }
            check(file)
        } finally { dir.deleteRecursively() }
    }

    private fun headers() = page(0, 0, 2, identification) + page(1, 0, 0, comment("TITLE=Track"), setup)

    @Test fun replacesOnlyThePictureAndPreservesTagsAudioGranulesAndChecksums() {
        val audio = listOf(page(2, 44100, 0, byteArrayOf(11, 12)), page(3, 88200, 4, byteArrayOf(13, 14)))
        val input = page(0, 0, 2, identification) + page(1, 0, 0,
            comment("TITLE=Track", "ARTIST=Artist", "METADATA_BLOCK_PICTURE=old"), setup) + audio[0] + audio[1]
        withFile(input) { file ->
            val before = pages(file).takeLast(2)
            OggCoverRewriter.writeCover(file, "new-picture")
            val after = pages(file)
            val tags = String(packets(after)[1])
            assertTrue(tags.contains("TITLE=Track"))
            assertTrue(tags.contains("ARTIST=Artist"))
            assertTrue(tags.contains("test-vendor"))
            assertTrue(tags.contains("METADATA_BLOCK_PICTURE=new-picture"))
            assertFalse(tags.contains("METADATA_BLOCK_PICTURE=old"))
            assertEquals(after.indices.toList(), after.map { it.sequence })
            for ((old, written) in before.zip(after.takeLast(2))) {
                assertArrayEquals(old.body, written.body)
                assertArrayEquals(old.laces, written.laces)
                assertEquals(old.granule, written.granule)
                assertEquals(old.flags, written.flags)
            }
        }
    }

    @Test fun readsACommentThatContinuesAcrossPagesAndRepaginatesTheNewPicture() {
        val oldComment = comment("TITLE=Track", "METADATA_BLOCK_PICTURE=" + "x".repeat(70_000))
        val first = rawPage(Page(serial, 1, -1, 0, ByteArray(255) { 255.toByte() }, oldComment.copyOfRange(0, 65025)))
        val rest = oldComment.copyOfRange(65025, oldComment.size)
        val input = page(0, 0, 2, identification) + first + page(2, 0, 1, rest, setup) + page(3, 44100, 4, byteArrayOf(8, 9))
        withFile(input) { file ->
            OggCoverRewriter.writeCover(file, "y".repeat(90_000))
            val result = pages(file)
            val decoded = packets(result)
            assertArrayEquals(identification, decoded[0])
            assertArrayEquals(setup, decoded[2])
            assertArrayEquals(byteArrayOf(8, 9), decoded[3])
            assertTrue(String(decoded[1]).contains("y".repeat(90_000)))
            assertTrue(result.any { it.flags and 1 != 0 })
        }
    }

    @Test fun keepsAudioSharingTheLastHeaderPage() {
        val audio = byteArrayOf(4, 5, 6)
        withFile(page(0, 0, 2, identification) + page(1, 44100, 4, comment("TITLE=Track"), setup, audio)) { file ->
            OggCoverRewriter.writeCover(file, "new")
            val result = pages(file)
            assertArrayEquals(audio, packets(result).last())
            assertEquals(44100L, result.last().granule)
            assertEquals(4, result.last().flags)
        }
    }

    @Test fun leavesOtherLogicalStreamSequencesAlone() {
        val other = page(17, 123, 6, byteArrayOf(12, 13), stream = 987)
        withFile(headers() + page(2, 44100, 4, byteArrayOf(8, 9)) + other) { file ->
            OggCoverRewriter.writeCover(file, "new")
            val last = pages(file).last()
            assertEquals(987, last.serial)
            assertEquals(17, last.sequence)
            assertArrayEquals(other, rawPage(last))
        }
    }

    @Test fun rejectsTruncatedOrInvalidFilesWithoutReplacingTheOriginal() {
        val valid = headers() + page(2, 44100, 4, byteArrayOf(8, 9))
        for (broken in listOf(valid.dropLast(1).toByteArray(), valid + byteArrayOf(1), "not ogg".toByteArray())) {
            withFile(broken) { file ->
                assertThrows(IOException::class.java) { OggCoverRewriter.writeCover(file, "new") }
                assertArrayEquals(broken, file.readBytes())
                assertFalse(File("${file.path}.tmp_cover").exists())
            }
        }
    }

    @Test fun rewritesAudioLargerThanTheWorkerHeap() {
        // src/test is also packaged in androidTest; only a host JVM can launch a constrained JVM.
        assumeFalse(System.getProperty("java.vm.name").contains("Dalvik", ignoreCase = true))
        val dir = Files.createTempDirectory("ogg-cover-heap").toFile()
        try {
            val file = File(dir, "large.ogg")
            val audioBody = ByteArray(65025) { 42 }
            file.outputStream().buffered().use { out ->
                out.write(headers())
                for (n in 0 until 775) out.write(rawPage(Page(serial, n + 2, n.toLong(),
                    if (n == 774) 4 else 0, ByteArray(255) { 255.toByte() }, audioBody)))
            }
            assertTrue(file.length() > 48_000_000L)
            val classPath = listOf(OggCoverRewriter::class.java, OggCoverMemoryProbe::class.java, Unit::class.java)
                .map { File(it.protectionDomain.codeSource.location.toURI()).path }.distinct().joinToString(File.pathSeparator)
            val log = File(dir, "worker.log")
            val process = ProcessBuilder(File(System.getProperty("java.home"), "bin/java").path,
                "-Xmx24m", "-cp", classPath, OggCoverMemoryProbe::class.java.name, file.path)
                .redirectErrorStream(true).redirectOutput(log).start()
            try {
                assertTrue("worker timed out", process.waitFor(45, TimeUnit.SECONDS))
                assertEquals(log.readText(), 0, process.exitValue())
                assertTrue(file.length() > 48_000_000L)
            } finally { process.destroyForcibly() }
        } finally { dir.deleteRecursively() }
    }
}

/** Standalone worker so the regression has a fixed heap, independently of Gradle's JVM size. */
object OggCoverMemoryProbe {
    @JvmStatic fun main(args: Array<String>) {
        OggCoverRewriter.writeCover(File(args.single()), "small-picture")
    }
}
