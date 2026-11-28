package `fun`.upup.musicfree.cenc

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.EOFException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class CencProxyTest {
    private class FakeDecoder : CencStreamDecoder {
        val closeCount = AtomicInteger(0)
        override val header: ByteArray = byteArrayOf(1, 2, 3, 4)
        override val headerSize: Long = 4L
        override val mdatFileOffset: Long = 4L
        override val outputTotalSize: Long = 100L

        override fun decrypt(relativeOffset: Long, data: ByteArray, offset: Int, length: Int) {
            if (closeCount.get() > 0) {
                throw IllegalStateException("decoder is closed")
            }
        }

        override fun close() {
            closeCount.incrementAndGet()
        }
    }

    @Test
    fun activeStreamLeasePreventsDecoderCloseDuringEvictionAndShutdown() {
        var now = 1_000L
        val registry = CencProxy.SessionRegistry(maxSessions = 2, idleTimeoutMs = 10_000L) { now }
        val decoderA = FakeDecoder()
        val decoderB = FakeDecoder()
        val decoderC = FakeDecoder()

        registry.register("tok-a", "https://cdn.example.com/a.m4a", emptyMap(), decoderA)
        val leaseA = registry.acquire("tok-a")
        assertNotNull(leaseA)

        now += 100L
        registry.register("tok-b", "https://cdn.example.com/b.m4a", emptyMap(), decoderB)
        now += 100L
        // Capacity is 2, A is older than B, but A has an active lease -> B must be evicted, A remains open.
        registry.register("tok-c", "https://cdn.example.com/c.m4a", emptyMap(), decoderC)

        assertTrue(registry.contains("tok-a"))
        assertFalse(registry.contains("tok-b"))
        assertTrue(registry.contains("tok-c"))
        assertEquals(0, decoderA.closeCount.get())
        assertEquals(1, decoderB.closeCount.get())
        assertEquals(0, decoderC.closeCount.get())

        // Shutdown retires A and C; C has no active stream so closes immediately, A waits for lease release.
        registry.clear()
        assertEquals(0, decoderA.closeCount.get())
        assertEquals(1, decoderC.closeCount.get())

        leaseA!!.close()
        // Idempotent second close must not underflow or double-close.
        leaseA.close()
        assertEquals(1, decoderA.closeCount.get())
    }

    @Test
    fun idleSessionEvictionClosesInactiveDecoders() {
        var now = 5_000L
        val registry = CencProxy.SessionRegistry(maxSessions = 4, idleTimeoutMs = 1_000L) { now }
        val idleDecoder = FakeDecoder()
        val activeDecoder = FakeDecoder()

        registry.register("idle", "https://cdn.example.com/idle.m4a", emptyMap(), idleDecoder)
        registry.register("active", "https://cdn.example.com/active.m4a", emptyMap(), activeDecoder)
        val lease = registry.acquire("active")
        assertNotNull(lease)

        now += 2_000L
        val evicted = registry.evictIdle()
        assertEquals(1, evicted)
        assertFalse(registry.contains("idle"))
        assertTrue(registry.contains("active"))
        assertEquals(1, idleDecoder.closeCount.get())
        assertEquals(0, activeDecoder.closeCount.get())

        lease!!.close()
        now += 2_000L
        assertEquals(1, registry.evictIdle())
        assertEquals(1, activeDecoder.closeCount.get())
    }

    @Test
    fun verifyContentRangeStartRejectsMissingOrMismatchedRangeOn206() {
        CencProxy.verifyContentRangeStart("bytes 128-255/1024", 128L, expectedMinEnd = 255L, expectedTotal = 1024L)
        CencProxy.verifyContentRangeStart("bytes 0-0/*", 0L)

        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart(null, 128L)
        }
        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart("bytes 0-255/1024", 128L)
        }
        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart("bytes 200-100/1024", 200L)
        }
        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart("items 128-255/1024", 128L)
        }
        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart("bytes 128-200/1024", 128L, expectedMinEnd = 255L)
        }
        assertThrows(IllegalStateException::class.java) {
            CencProxy.verifyContentRangeStart("bytes 128-255/2048", 128L, expectedTotal = 1024L)
        }
    }

    @Test
    fun ensureAllowedRangeSkipRejectsLarge200FallbackOffset() {
        CencProxy.ensureAllowedRangeSkip(0L)
        CencProxy.ensureAllowedRangeSkip(2L * 1024L * 1024L)

        assertThrows(IllegalStateException::class.java) {
            CencProxy.ensureAllowedRangeSkip(2L * 1024L * 1024L + 1L)
        }
    }

    @Test
    fun proxyLifecycleRejectsLateRegistrationAfterOwnerDetachAndClosesOrphanDecoder() {
        val lifecycle = CencProxy.ProxyLifecycle()
        val ownerId = lifecycle.attachOwner()
        val snap = lifecycle.snapshotForRegistration(ownerId)
        val shutdownCalled = AtomicBoolean(false)
        lifecycle.detachOwner(ownerId) { shutdownCalled.set(true) }
        assertTrue(shutdownCalled.get())

        val orphan = FakeDecoder()
        assertThrows(IllegalStateException::class.java) {
            lifecycle.commitRegistration(
                ownerId = ownerId,
                expectedGeneration = snap,
                onRejected = { orphan.close() },
            ) {
                "unreachable"
            }
        }
        assertEquals(1, orphan.closeCount.get())
    }

    @Test
    fun decryptingInputStreamFailsExplicitlyWhenUpstreamTruncatesEarly() {
        val dummyResponse = Response.Builder()
            .request(Request.Builder().url("https://cdn.example.com/a.m4a").build())
            .protocol(Protocol.HTTP_1_1)
            .code(206)
            .message("Partial Content")
            .body(ByteArray(0).toResponseBody(null))
            .build()
        val shortStream = ByteArrayInputStream(byteArrayOf(10, 20, 30))
        val decoder = FakeDecoder()

        CencProxy.DecryptingInputStream(
            response = dummyResponse,
            input = shortStream,
            decoder = decoder,
            relativeOffset = 0L,
            remaining = 8L,
        ).use { stream ->
            val buf = ByteArray(8)
            val firstRead = stream.read(buf, 0, 8)
            assertEquals(3, firstRead)
            assertThrows(EOFException::class.java) {
                stream.read(buf, 3, 5)
            }
        }
    }
}
