package `fun`.upup.musicfree.qmc

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class QmcRemoteSourceTest {
    private val server = MockWebServer()

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun readsStrict206RangesAndReportsTotalSize() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 0-0/10")
                .setBody("0"),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 3-6/10")
                .setBody("3456"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mflac").toString(),
            mapOf("Referer" to "https://example.com/"),
            OkHttpClient(),
        )

        assertEquals(10L, source.size)
        assertArrayEquals("3456".toByteArray(), source.readAt(3L, 4))
        assertEquals("bytes=0-0", server.takeRequest().getHeader("Range"))
        assertEquals("bytes=3-6", server.takeRequest().getHeader("Range"))
    }

    @Test
    fun supportsBoundedFallbackWhenUpstreamIgnoresRange() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Length", "10")
                .setBody("0123456789"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mgg").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        source.openRange(3L, 6L).use { input ->
            assertArrayEquals("3456".toByteArray(), input.readBytes())
        }
    }

    @Test
    fun supportsChunkedIgnoredRangeFallbackAfterSizeDiscovery() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 0-0/10")
                .setBody("0"),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setChunkedBody("0123456789", 3),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mgg").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertEquals(10L, source.size)
        source.openRange(3L, 6L).use { input ->
            assertArrayEquals("3456".toByteArray(), input.readBytes())
        }
    }

    @Test
    fun rejectsMismatchedContentRange() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 2-5/10")
                .setBody("2345"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mflac").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertThrows(IllegalArgumentException::class.java) {
            source.readAt(3L, 4)
        }
    }

    @Test
    fun rejectsAnOversizedContentRangeForABoundedRead() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 3-7/10")
                .setBody("34567"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mflac").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertThrows(IllegalArgumentException::class.java) {
            source.readAt(3L, 4)
        }
    }

    @Test
    fun rejectsTotalSizeChangesBetweenRangeRequests() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 0-0/10")
                .setBody("0"),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 3-6/11")
                .setBody("3456"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mgg").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertEquals(10L, source.size)
        assertThrows(IllegalArgumentException::class.java) {
            source.readAt(3L, 4)
        }
    }

    @Test
    fun rejectsUpstreamRangeNotSatisfiableResponses() {
        server.enqueue(
            MockResponse()
                .setResponseCode(416)
                .setHeader("Content-Range", "bytes */10"),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mgg").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertThrows(IllegalArgumentException::class.java) {
            source.readAt(3L, 4)
        }
    }

    @Test
    fun reportsAnEarlyEndWhileStreamingAChunkedRange() {
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 3-6/10")
                .setChunkedBody("34", 1),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mflac").toString(),
            emptyMap(),
            OkHttpClient(),
        )

        assertThrows(IOException::class.java) {
            source.openRange(3L, 6L).use { it.readBytes() }
        }
    }

    @Test
    fun rejectsLargeSeeksWhenUpstreamIgnoresRange() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setChunkedBody("x", 1),
        )
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mgg").toString(),
            emptyMap(),
            OkHttpClient(),
        )
        val start = 16L * 1024L * 1024L + 1L

        assertThrows(IllegalArgumentException::class.java) {
            source.openRange(start, start).use { it.read() }
        }
    }

    @Test
    fun supportsConcurrentRandomAccessReads() {
        val payload = ByteArray(256) { index -> ('A'.code + index % 26).toByte() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val range = requireNotNull(request.getHeader("Range"))
                val match = requireNotNull(Regex("^bytes=(\\d+)-(\\d+)$").matchEntire(range))
                val start = match.groupValues[1].toInt()
                val end = match.groupValues[2].toInt()
                return MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Range", "bytes $start-$end/${payload.size}")
                    .setBody(Buffer().write(payload, start, end - start + 1))
            }
        }
        server.start()
        val source = QmcRemoteSource(
            server.url("/track.mflac").toString(),
            emptyMap(),
            OkHttpClient(),
        )
        assertEquals(payload.size.toLong(), source.size)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val first = executor.submit<ByteArray> { source.readAt(17L, 31) }
            val second = executor.submit<ByteArray> { source.readAt(129L, 47) }
            assertArrayEquals(
                payload.copyOfRange(17, 48),
                first.get(5, TimeUnit.SECONDS),
            )
            assertArrayEquals(
                payload.copyOfRange(129, 176),
                second.get(5, TimeUnit.SECONDS),
            )
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun parsesClientRangesIncludingSuffixAndOpenEnded() {
        assertEquals(QmcHttpByteRange(10, 19), parseQmcHttpRange("bytes=10-19", 100))
        assertEquals(QmcHttpByteRange(10, 99), parseQmcHttpRange("bytes=10-", 100))
        assertEquals(QmcHttpByteRange(90, 99), parseQmcHttpRange("bytes=-10", 100))
        assertEquals(QmcHttpByteRange(0, 99), parseQmcHttpRange("bytes=-1000", 100))
        assertNull(parseQmcHttpRange("bytes=100-101", 100))
        assertNull(parseQmcHttpRange("bytes=1-2,4-5", 100))
    }

    @Test
    fun parsesOnlyValidProxyTokens() {
        val token = "0123456789abcdef0123456789abcdef"

        assertEquals(token, parseQmcProxyToken("/l/$token.flac"))
        assertEquals(token.uppercase(), parseQmcProxyToken("/l/${token.uppercase()}"))
        assertNull(parseQmcProxyToken("/invalid/$token.flac"))
        assertNull(parseQmcProxyToken("/l/short.flac"))
        assertNull(parseQmcProxyToken("/l/$token.flac/extra"))
    }
}
