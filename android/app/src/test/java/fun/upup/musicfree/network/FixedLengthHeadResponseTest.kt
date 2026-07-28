package `fun`.upup.musicfree.network

import fi.iki.elonen.NanoHTTPD
import java.net.InetSocketAddress
import java.net.Socket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FixedLengthHeadResponseTest {
    @Test
    fun `HEAD response sends exactly one content length header`() {
        val server = object : NanoHTTPD("127.0.0.1", 0) {
            override fun serve(session: IHTTPSession): Response =
                fixedLengthHeadResponse(Response.Status.OK, "audio/flac", 123L)
        }
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
        try {
            val headers = Socket().use { socket ->
                socket.connect(InetSocketAddress("127.0.0.1", server.listeningPort), 2_000)
                socket.soTimeout = 2_000
                socket.getOutputStream().apply {
                    write(
                        (
                            "HEAD /audio HTTP/1.1\r\n" +
                                "Host: 127.0.0.1\r\n" +
                                "Connection: close\r\n\r\n"
                        ).toByteArray(Charsets.US_ASCII),
                    )
                    flush()
                }
                val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
                buildList {
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        add(line)
                    }
                }
            }
            val contentLengths = headers
                .filter { it.startsWith("Content-Length:", ignoreCase = true) }
                .map { it.substringAfter(':').trim() }
            assertEquals(listOf("123"), contentLengths)
        } finally {
            server.stop()
        }
    }

    @Test
    fun `HEAD response rejects a negative content length`() {
        assertThrows(IllegalArgumentException::class.java) {
            fixedLengthHeadResponse(NanoHTTPD.Response.Status.OK, "audio/flac", -1L)
        }
    }
}
