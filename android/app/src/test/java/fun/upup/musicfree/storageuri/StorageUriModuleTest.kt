package `fun`.upup.musicfree.storageuri

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean

class StorageUriModuleTest {
    @Test
    fun copyStreamBoundedCopiesPayloadsWithinLimit() {
        val payload = ByteArray(24 * 1024) { idx -> (idx % 199).toByte() }
        val out = ByteArrayOutputStream()

        val copied = StorageUriModule.copyStreamBounded(
            ByteArrayInputStream(payload),
            out,
            maxBytes = 32 * 1024L
        )

        assertEquals(payload.size.toLong(), copied)
        assertArrayEquals(payload, out.toByteArray())
    }

    @Test
    fun copyStreamBoundedRejectsPayloadsExceedingMaxBytes() {
        val payload = ByteArray(16 * 1024) { 7 }
        val out = ByteArrayOutputStream()

        assertThrows(IllegalArgumentException::class.java) {
            StorageUriModule.copyStreamBounded(
                ByteArrayInputStream(payload),
                out,
                maxBytes = 10 * 1024L
            )
        }
    }

    @Test
    fun copyStreamBoundedAbortsWhenCancelledMidStream() {
        val cancelled = AtomicBoolean(true)
        val out = ByteArrayOutputStream()

        assertThrows(IllegalStateException::class.java) {
            StorageUriModule.copyStreamBounded(
                ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)),
                out,
                maxBytes = 1024L
            ) {
                cancelled.get()
            }
        }
    }

    @Test
    fun commitTemporaryFileAbortsAndCleansUpWhenCancelledAroundSyncBoundary() {
        val dir = Files.createTempDirectory("storageuri-commit-test").toFile()
        try {
            val temp1 = dir.resolve("a.tmp").apply { writeBytes(byteArrayOf(1, 2, 3)) }
            val dest1 = dir.resolve("a.mp3")
            assertThrows(IllegalStateException::class.java) {
                StorageUriModule.commitTemporaryFile(temp1, dest1) { true }
            }
            assertFalse(temp1.exists())
            assertFalse(dest1.exists())

            val temp2 = dir.resolve("b.tmp").apply { writeBytes(byteArrayOf(4, 5, 6)) }
            val dest2 = dir.resolve("b.mp3")
            var checks = 0
            assertThrows(IllegalStateException::class.java) {
                StorageUriModule.commitTemporaryFile(temp2, dest2) {
                    checks += 1
                    checks >= 2 // flips to cancelled immediately after renameTo
                }
            }
            assertFalse(temp2.exists())
            assertFalse(dest2.exists())

            val temp3 = dir.resolve("c.tmp").apply { writeBytes(byteArrayOf(7, 8, 9)) }
            val dest3 = dir.resolve("c.mp3")
            StorageUriModule.commitTemporaryFile(temp3, dest3) { false }
            assertFalse(temp3.exists())
            assertTrue(dest3.exists())
            assertArrayEquals(byteArrayOf(7, 8, 9), dest3.readBytes())
        } finally {
            dir.deleteRecursively()
        }
    }
}
