package `fun`.upup.musicfree.qmc

import fi.iki.elonen.NanoHTTPD
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class QmcProxyStreamTest {
    @Test
    fun readFailureClosesUpstreamAndFinishesExactlyOnce() {
        val upstreamClosed = AtomicBoolean(false)
        val finishCount = AtomicInteger()
        val upstream = object : InputStream() {
            override fun read(): Int = throw IOException("upstream failed")

            override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
                throw IOException("upstream failed")

            override fun close() {
                upstreamClosed.set(true)
            }
        }
        val stream = DecryptingInputStream(
            encrypted = upstream,
            decrypt = { _, _, _, _ -> },
            absoluteOffset = 0L,
            remaining = 4L,
            onFinished = { finishCount.incrementAndGet() },
        )

        assertThrows(IOException::class.java) {
            stream.read(ByteArray(4))
        }
        stream.close()

        assertTrue(upstreamClosed.get())
        assertEquals(1, finishCount.get())
    }

    @Test
    fun sendFailureClosesResponseBodyWhenClientDisconnects() {
        val upstreamClosed = AtomicBoolean(false)
        val finishCount = AtomicInteger()
        val upstream = object : InputStream() {
            private val bytes = "stream-data".toByteArray()
            private var offset = 0

            override fun read(): Int =
                if (offset >= bytes.size) -1 else bytes[offset++].toInt() and 0xff

            override fun read(buffer: ByteArray, targetOffset: Int, length: Int): Int {
                if (offset >= bytes.size) return -1
                val count = minOf(length, bytes.size - offset)
                bytes.copyInto(buffer, targetOffset, offset, offset + count)
                offset += count
                return count
            }

            override fun close() {
                upstreamClosed.set(true)
            }
        }
        val stream = DecryptingInputStream(
            encrypted = upstream,
            decrypt = { _, _, _, _ -> },
            absoluteOffset = 0L,
            remaining = 11L,
            onFinished = { finishCount.incrementAndGet() },
        )
        val response = TestCloseOnSendResponse(stream, 11L).also {
            it.setRequestMethod(NanoHTTPD.Method.GET)
        }

        response.sendTo(object : OutputStream() {
            override fun write(value: Int) {
                throw IOException("client disconnected")
            }
        })
        response.close()

        assertTrue(upstreamClosed.get())
        assertEquals(1, finishCount.get())
    }

    private class TestCloseOnSendResponse(
        data: InputStream,
        totalBytes: Long,
    ) : CloseOnSendResponse(
        NanoHTTPD.Response.Status.OK,
        "application/octet-stream",
        data,
        totalBytes,
    ) {
        fun sendTo(outputStream: OutputStream) {
            send(outputStream)
        }
    }
}
