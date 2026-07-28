package `fun`.upup.musicfree.qmc

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import kotlin.math.min

internal class QmcRemoteSource(
    private val url: String,
    private val headers: Map<String, String>,
    private val client: OkHttpClient,
) : QmcRandomAccessSource {
    @Volatile
    private var discoveredSize: Long? = null

    override val size: Long by lazy {
        val probe = fetchRange(0L, 0L)
        requireNotNull(probe.totalSize) { "QMC upstream did not report its total size" }
            .also { require(it > 0L) { "QMC upstream is empty" } }
            .also { discoveredSize = it }
    }

    override fun readAt(offset: Long, length: Int): ByteArray {
        require(offset >= 0L && length >= 0) { "QMC read range is invalid" }
        if (length == 0) return ByteArray(0)
        require(offset <= Long.MAX_VALUE - length) { "QMC read range overflows" }
        val result = fetchRange(offset, offset + length - 1L)
        require(result.body.size == length) { "QMC upstream range is truncated" }
        return result.body
    }

    fun openRange(start: Long, end: Long): InputStream {
        require(start >= 0L && end >= start) { "QMC stream range is invalid" }
        val response = client.newCall(request("bytes=$start-$end")).execute()
        try {
            validateResponse(response, start, end)
            val body = requireNotNull(response.body) { "QMC upstream returned an empty body" }
            val input = body.byteStream()
            if (response.code == 200 && start > 0L) {
                require(start <= MAX_IGNORED_RANGE_SKIP) {
                    "QMC upstream ignored a large Range request"
                }
                skipFully(input, start)
            }
            return BoundedResponseInputStream(
                response = response,
                input = input,
                remaining = end - start + 1L,
            )
        } catch (error: Throwable) {
            response.close()
            throw error
        }
    }

    private fun fetchRange(start: Long, end: Long): RangeResult {
        require(start >= 0L && end >= start) { "QMC fetch range is invalid" }
        val expected = end - start + 1L
        require(expected <= MAX_BUFFERED_RANGE) { "QMC buffered range is too large" }
        client.newCall(request("bytes=$start-$end")).execute().use { response ->
            val totalSize = validateResponse(response, start, end)
            val input = requireNotNull(response.body) { "QMC upstream returned an empty body" }
                .byteStream()
            if (response.code == 200 && start > 0L) {
                require(start <= MAX_IGNORED_RANGE_SKIP) {
                    "QMC upstream ignored a large Range request"
                }
                skipFully(input, start)
            }
            val output = ByteArrayOutputStream(expected.toInt())
            val buffer = ByteArray(min(DEFAULT_BUFFER_SIZE.toLong(), expected).toInt())
            var remaining = expected
            while (remaining > 0L) {
                val read = input.read(buffer, 0, min(buffer.size.toLong(), remaining).toInt())
                if (read < 0) break
                output.write(buffer, 0, read)
                remaining -= read
            }
            return RangeResult(output.toByteArray(), totalSize)
        }
    }

    private fun validateResponse(
        response: Response,
        expectedStart: Long,
        expectedEnd: Long,
    ): Long? {
        require(response.code == 200 || response.code == 206) {
            "QMC upstream returned HTTP ${response.code}"
        }
        if (response.code == 206) {
            val contentRange = requireNotNull(response.header("Content-Range")) {
                "QMC upstream 206 response has no Content-Range"
            }
            val match = CONTENT_RANGE_PATTERN.matchEntire(contentRange.trim())
                ?: throw IllegalArgumentException("QMC upstream Content-Range is invalid")
            val responseStart = match.groupValues[1].toLong()
            val responseEnd = match.groupValues[2].toLong()
            require(responseStart == expectedStart && responseEnd == expectedEnd) {
                "QMC upstream returned an unexpected byte range"
            }
            val totalSize = match.groupValues[3].takeUnless { it == "*" }?.toLong()
            if (totalSize != null) {
                require(totalSize > responseEnd) {
                    "QMC upstream Content-Range total is invalid"
                }
            }
            validateDiscoveredSize(totalSize)
            response.body?.contentLength()?.takeIf { it >= 0L }?.let { contentLength ->
                require(contentLength == expectedEnd - expectedStart + 1L) {
                    "QMC upstream range body length is inconsistent"
                }
            }
            return totalSize
        }
        val totalSize = response.header("Content-Length")?.toLongOrNull()
            ?: response.body?.contentLength()?.takeIf { it >= 0L }
        validateDiscoveredSize(totalSize)
        return totalSize
    }

    private fun validateDiscoveredSize(responseSize: Long?) {
        if (responseSize == null) return
        discoveredSize?.let { expectedSize ->
            require(responseSize == expectedSize) {
                "QMC upstream total size changed between range requests"
            }
        }
    }

    private fun request(range: String): Request {
        val builder = Request.Builder().url(url)
        headers.forEach { (rawName, rawValue) ->
            val name = rawName.trim()
            val value = rawValue.trim()
            if (
                name.isNotEmpty() &&
                value.isNotEmpty() &&
                !FORBIDDEN_FORWARD_HEADERS.contains(name.lowercase())
            ) {
                builder.header(name, value)
            }
        }
        return builder
            .header("Accept-Encoding", "identity")
            .header("Range", range)
            .get()
            .build()
    }

    private fun skipFully(input: InputStream, count: Long) {
        var remaining = count
        val scratch = ByteArray(DEFAULT_BUFFER_SIZE)
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
                continue
            }
            val read = input.read(scratch, 0, min(scratch.size.toLong(), remaining).toInt())
            require(read >= 0) { "QMC upstream ended while seeking to byte $count" }
            remaining -= read
        }
    }

    private data class RangeResult(
        val body: ByteArray,
        val totalSize: Long?,
    )

    private class BoundedResponseInputStream(
        private val response: Response,
        private val input: InputStream,
        private var remaining: Long,
    ) : InputStream() {
        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (remaining == 0L) return -1
            val requested = min(length.toLong(), remaining).toInt()
            val read = input.read(buffer, offset, requested)
            if (read < 0) {
                throw IOException("QMC upstream range ended early with $remaining bytes remaining")
            }
            remaining -= read
            return read
        }

        override fun close() {
            response.close()
        }
    }

    private companion object {
        const val MAX_BUFFERED_RANGE = 1024L * 1024L
        const val MAX_IGNORED_RANGE_SKIP = 16L * 1024L * 1024L
        const val DEFAULT_BUFFER_SIZE = 64 * 1024
        val CONTENT_RANGE_PATTERN = Regex("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$")
        val FORBIDDEN_FORWARD_HEADERS = setOf(
            "host",
            "range",
            "accept-encoding",
            "content-length",
            "transfer-encoding",
            "connection",
        )
    }
}
