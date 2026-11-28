package `fun`.upup.musicfree.storageuri

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
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
}
