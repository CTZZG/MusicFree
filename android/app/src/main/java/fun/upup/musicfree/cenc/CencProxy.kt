package `fun`.upup.musicfree.cenc

import fi.iki.elonen.NanoHTTPD
import `fun`.upup.musicfree.network.fixedLengthHeadResponse
import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response as OkHttpResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.SequenceInputStream
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

internal object CencProxy {
    private const val PROBE_SIZE = 256 * 1024
    private const val MAX_BOX_SIZE = 64L * 1024L * 1024L
    private const val MAX_SESSIONS = 256
    private const val IDLE_TIMEOUT_MS = 30L * 60L * 1000L
    private const val MAX_IGNORED_RANGE_SKIP = 2L * 1024L * 1024L
    private val contentRangeRegex =
        Regex("""^bytes\s+(\d+)-(\d+)/(?:\d+|\*)$""", RegexOption.IGNORE_CASE)

    private val registry = SessionRegistry()
    private val client = PublicHttpsNetworkPolicy.clientBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Volatile
    private var server: Server? = null

    data class Layout(
        val ftyp: ByteArray,
        val moov: ByteArray,
        val mdatPayloadOffset: Long,
        val mdatPayloadSize: Long,
    )

    internal class StreamSession(
        val token: String,
        val src: String,
        val headers: Map<String, String>,
        val decoder: CencStreamDecoder,
        val createdAt: Long = System.currentTimeMillis(),
        var lastAccessAt: Long = createdAt,
        var activeStreams: Int = 0,
        var retired: Boolean = false,
        var closed: Boolean = false,
    )

    internal class StreamLease internal constructor(
        val session: StreamSession,
        private val releaseAction: (StreamSession) -> Unit,
    ) : Closeable {
        private val released = AtomicBoolean(false)

        override fun close() {
            if (released.compareAndSet(false, true)) {
                releaseAction(session)
            }
        }
    }

    internal class SessionRegistry(
        private val maxSessions: Int = MAX_SESSIONS,
        private val idleTimeoutMs: Long = IDLE_TIMEOUT_MS,
        private val now: () -> Long = System::currentTimeMillis,
    ) {
        init {
            require(maxSessions > 0) { "CENC session capacity must be positive" }
            require(idleTimeoutMs > 0L) { "CENC session idle timeout must be positive" }
        }

        private val lock = Any()
        private val sessions = LinkedHashMap<String, StreamSession>()

        fun register(
            token: String,
            src: String,
            headers: Map<String, String>,
            decoder: CencStreamDecoder,
        ): StreamSession {
            val toClose = mutableListOf<CencStreamDecoder>()
            val session: StreamSession
            try {
                synchronized(lock) {
                    val currentTime = now()
                    evictIdleLocked(currentTime, toClose)
                    while (sessions.size >= maxSessions) {
                        val oldestInactive = sessions.values
                            .filter { it.activeStreams == 0 }
                            .minWithOrNull(
                                compareBy<StreamSession> { it.lastAccessAt }
                                    .thenBy { it.createdAt },
                            )
                            ?: throw IllegalStateException("CENC proxy session capacity is busy")
                        sessions.remove(oldestInactive.token)
                        markRetiredAndCollectLocked(oldestInactive, toClose)
                    }
                    val created = StreamSession(
                        token = token,
                        src = src,
                        headers = headers,
                        decoder = decoder,
                        createdAt = currentTime,
                        lastAccessAt = currentTime,
                    )
                    sessions[token] = created
                    session = created
                }
            } finally {
                closeAllSafely(toClose)
            }
            return session
        }

        fun acquire(token: String): StreamLease? {
            val toClose = mutableListOf<CencStreamDecoder>()
            val lease: StreamLease?
            try {
                synchronized(lock) {
                    val currentTime = now()
                    evictIdleLocked(currentTime, toClose)
                    val session = sessions[token] ?: return null
                    session.activeStreams += 1
                    session.lastAccessAt = currentTime
                    lease = StreamLease(session) { released -> release(released) }
                }
            } finally {
                closeAllSafely(toClose)
            }
            return lease
        }

        fun evictIdle(): Int {
            val toClose = mutableListOf<CencStreamDecoder>()
            val count = synchronized(lock) {
                evictIdleLocked(now(), toClose)
            }
            closeAllSafely(toClose)
            return count
        }

        fun clear() {
            val toClose = mutableListOf<CencStreamDecoder>()
            synchronized(lock) {
                sessions.values.forEach { session ->
                    markRetiredAndCollectLocked(session, toClose)
                }
                sessions.clear()
            }
            closeAllSafely(toClose)
        }

        internal fun contains(token: String): Boolean = synchronized(lock) {
            sessions.containsKey(token)
        }

        internal val size: Int
            get() = synchronized(lock) { sessions.size }

        private fun release(session: StreamSession) {
            var decoderToClose: CencStreamDecoder? = null
            synchronized(lock) {
                check(session.activeStreams > 0) { "CENC session lease underflow" }
                session.activeStreams -= 1
                session.lastAccessAt = now()
                if (session.retired && session.activeStreams == 0 && !session.closed) {
                    session.closed = true
                    decoderToClose = session.decoder
                }
            }
            decoderToClose?.let { runCatching { it.close() } }
        }

        private fun evictIdleLocked(
            currentTime: Long,
            toClose: MutableList<CencStreamDecoder>,
        ): Int {
            val expired = sessions.values.filter { session ->
                session.activeStreams == 0 && currentTime - session.lastAccessAt >= idleTimeoutMs
            }
            expired.forEach { session ->
                sessions.remove(session.token)
                markRetiredAndCollectLocked(session, toClose)
            }
            return expired.size
        }

        private fun markRetiredAndCollectLocked(
            session: StreamSession,
            toClose: MutableList<CencStreamDecoder>,
        ) {
            session.retired = true
            if (session.activeStreams == 0 && !session.closed) {
                session.closed = true
                toClose.add(session.decoder)
            }
        }

        private fun closeAllSafely(decoders: List<CencStreamDecoder>) {
            decoders.forEach { decoder ->
                runCatching { decoder.close() }
            }
        }
    }

    private data class RangeResult(
        val body: ByteArray,
        val totalSize: Long?,
    )

    private data class BoxHeader(
        val type: String,
        val size: Long,
        val headerSize: Int,
    )

    private data class ByteRange(
        val start: Long,
        val end: Long,
    )

    @Synchronized
    private fun ensureStarted(): String {
        if (server == null) {
            server = Server().also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }
        val listeningPort = requireNotNull(server).listeningPort
        check(listeningPort > 0) { "CENC proxy did not obtain a listening port" }
        return "http://127.0.0.1:$listeningPort"
    }

    fun register(src: String, cek: String, headers: Map<String, String>): String {
        PublicHttpsNetworkPolicy.requirePublicRemote(src)
        val normalizedCek = cek.trim()
        require(normalizedCek.matches(Regex("^[0-9a-fA-F]{32}$"))) {
            "invalid cek (expected 32 hexadecimal characters)"
        }

        val baseUrl = ensureStarted()
        val layout = discoverLayout(src, headers)
        val decoder = CencDecoder(
            layout.ftyp,
            layout.moov,
            normalizedCek.hexToByteArray(),
            layout.mdatPayloadOffset,
            layout.mdatPayloadSize,
        )
        val token = UUID.randomUUID().toString().replace("-", "")
        try {
            registry.register(token, src, headers, decoder)
        } catch (error: Throwable) {
            runCatching { decoder.close() }
            throw error
        }
        return "$baseUrl/l/$token.m4a"
    }

    fun shutdown() {
        synchronized(this) {
            server?.stop()
            server = null
        }
        registry.clear()
    }

    internal fun verifyContentRangeStart(contentRange: String?, expectedStart: Long) {
        val header = contentRange?.trim()
            ?: throw IllegalStateException("Unexpected Content-Range: missing header")
        val match = contentRangeRegex.matchEntire(header)
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        val actualStart = match.groupValues[1].toLongOrNull()
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        val actualEnd = match.groupValues[2].toLongOrNull()
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        if (actualStart != expectedStart || actualEnd < actualStart) {
            throw IllegalStateException("Unexpected Content-Range: $header (expected start $expectedStart)")
        }
    }

    internal fun ensureAllowedRangeSkip(skipBytes: Long) {
        if (skipBytes > MAX_IGNORED_RANGE_SKIP) {
            throw IllegalStateException("Upstream ignored Range for large offset ($skipBytes bytes)")
        }
    }

    private fun discoverLayout(src: String, headers: Map<String, String>): Layout {
        val first = fetchRange(src, headers, 0L, PROBE_SIZE.toLong() - 1L)
        val totalSize = first.totalSize ?: first.body.size.toLong()
        require(totalSize >= 8L) { "upstream CENC file is empty or truncated" }

        var ftyp: ByteArray? = null
        var moov: ByteArray? = null
        var mdatPayloadOffset: Long? = null
        var mdatPayloadSize: Long? = null
        var offset = 0L
        var guard = 0

        while (offset + 8L <= totalSize && guard++ < 4096) {
            val headerBytes = bytesAt(src, headers, offset, 16, first.body)
            val box = parseBoxHeader(headerBytes, totalSize - offset)
                ?: throw IllegalArgumentException("invalid MP4 box at offset $offset")
            require(box.size >= box.headerSize) { "invalid ${box.type} box size" }

            when (box.type) {
                "ftyp" -> ftyp = bytesAt(src, headers, offset, checkedBoxSize(box), first.body)
                "moov" -> moov = bytesAt(src, headers, offset, checkedBoxSize(box), first.body)
                "mdat" -> {
                    mdatPayloadOffset = offset + box.headerSize
                    mdatPayloadSize = box.size - box.headerSize
                }
            }

            if (ftyp != null && moov != null && mdatPayloadOffset != null) break
            offset += box.size
        }

        return Layout(
            ftyp ?: ByteArray(0),
            requireNotNull(moov) { "failed to locate moov box" },
            requireNotNull(mdatPayloadOffset) { "failed to locate mdat box" },
            requireNotNull(mdatPayloadSize),
        )
    }

    private fun checkedBoxSize(box: BoxHeader): Int {
        require(box.size in 1..MAX_BOX_SIZE) { "${box.type} box is too large" }
        return box.size.toInt()
    }

    private fun bytesAt(
        src: String,
        headers: Map<String, String>,
        offset: Long,
        length: Int,
        initialCache: ByteArray,
    ): ByteArray {
        require(length >= 0)
        if (offset >= 0L && offset + length <= initialCache.size.toLong()) {
            return initialCache.copyOfRange(offset.toInt(), offset.toInt() + length)
        }
        val result = fetchRange(src, headers, offset, offset + length - 1L).body
        require(result.size >= length) { "truncated upstream MP4 data at offset $offset" }
        return if (result.size == length) result else result.copyOf(length)
    }

    private fun parseBoxHeader(bytes: ByteArray, remaining: Long): BoxHeader? {
        if (bytes.size < 8) return null
        var size = readUInt32(bytes, 0)
        val type = bytes.copyOfRange(4, 8).toString(Charsets.ISO_8859_1)
        var headerSize = 8
        if (size == 1L) {
            if (bytes.size < 16) return null
            size = readUInt64(bytes, 8)
            headerSize = 16
        } else if (size == 0L) {
            size = remaining
        }
        if (size <= 0L || size > remaining) return null
        return BoxHeader(type, size, headerSize)
    }

    private fun fetchRange(
        src: String,
        headers: Map<String, String>,
        start: Long,
        end: Long,
    ): RangeResult {
        require(start >= 0L && end >= start)
        val request = upstreamRequest(src, headers, "bytes=$start-$end")
        client.newCall(request).execute().use { response ->
            require(response.code == 200 || response.code == 206) {
                "upstream returned HTTP ${response.code}"
            }
            if (response.code == 206) {
                verifyContentRangeStart(response.header("Content-Range"), start)
            }
            val total = parseTotalSize(response)
            val input = requireNotNull(response.body).byteStream()
            if (response.code == 200 && start > 0L) {
                ensureAllowedRangeSkip(start)
                skipFully(input, start)
            }
            val expected = end - start + 1L
            require(expected <= Int.MAX_VALUE) { "requested MP4 range is too large" }
            val output = ByteArrayOutputStream(expected.toInt())
            val buffer = ByteArray(64 * 1024)
            var remaining = expected
            while (remaining > 0L) {
                val read = input.read(buffer, 0, min(buffer.size.toLong(), remaining).toInt())
                if (read < 0) break
                output.write(buffer, 0, read)
                remaining -= read
            }
            return RangeResult(output.toByteArray(), total)
        }
    }

    private fun upstreamRequest(
        src: String,
        headers: Map<String, String>,
        range: String,
    ): Request {
        val builder = Request.Builder().url(src)
        headers.forEach { (name, value) ->
            if (!name.equals("host", true) &&
                !name.equals("range", true) &&
                !name.equals("accept-encoding", true)
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

    private fun parseTotalSize(response: OkHttpResponse): Long? {
        response.header("Content-Range")?.let { contentRange ->
            Regex("/(\\d+)\\s*$").find(contentRange)?.groupValues?.get(1)?.toLongOrNull()?.let {
                return it
            }
        }
        return if (response.code == 200) {
            response.header("Content-Length")?.toLongOrNull()
        } else {
            null
        }
    }

    private class Server : NanoHTTPD("127.0.0.1", 0) {
        override fun serve(request: IHTTPSession): Response {
            return try {
                if (request.method != Method.GET && request.method != Method.HEAD) {
                    return newFixedLengthResponse(
                        Response.Status.METHOD_NOT_ALLOWED,
                        "text/plain",
                        "method not allowed",
                    )
                }

                val token = parseToken(request.uri)
                val lease = registry.acquire(token) ?: return newFixedLengthResponse(
                    Response.Status.NOT_FOUND,
                    "text/plain",
                    "unknown stream",
                )
                try {
                    val stream = lease.session
                    val total = stream.decoder.outputTotalSize
                    val rangeHeader = request.headers["range"]
                    val range = parseRange(rangeHeader, total)
                    if (rangeHeader != null && range == null) {
                        lease.close()
                        return newFixedLengthResponse(
                            Response.Status.RANGE_NOT_SATISFIABLE,
                            "text/plain",
                            "invalid range",
                        ).also { it.addHeader("Content-Range", "bytes */$total") }
                    }
                    val start = range?.start ?: 0L
                    val end = range?.end ?: total - 1L
                    val length = end - start + 1L
                    val status = if (range == null) Response.Status.OK else Response.Status.PARTIAL_CONTENT

                    val response = if (request.method == Method.HEAD) {
                        lease.close()
                        fixedLengthHeadResponse(status, "audio/mp4", length)
                    } else {
                        val body = buildResponseStream(lease, start, end)
                        newFixedLengthResponse(status, "audio/mp4", body, length)
                    }
                    response.addHeader("Accept-Ranges", "bytes")
                    if (range != null) {
                        response.addHeader("Content-Range", "bytes $start-$end/$total")
                    }
                    response
                } catch (error: Exception) {
                    lease.close()
                    throw error
                }
            } catch (error: Exception) {
                newFixedLengthResponse(
                    Response.Status.INTERNAL_ERROR,
                    "text/plain",
                    error.message ?: "CENC proxy error",
                )
            }
        }

        private fun buildResponseStream(
            lease: StreamLease,
            start: Long,
            end: Long,
        ): InputStream {
            val stream = lease.session
            val headerSize = stream.decoder.headerSize
            val headerInput = if (start < headerSize) {
                val headerEndExclusive = min(end + 1L, headerSize).toInt()
                ByteArrayInputStream(
                    stream.decoder.header,
                    start.toInt(),
                    headerEndExclusive - start.toInt(),
                )
            } else {
                null
            }

            val mdatInput = if (end >= headerSize) {
                val relativeStart = max(start, headerSize) - headerSize
                val relativeEnd = end - headerSize
                openDecryptedMdat(stream, relativeStart, relativeEnd)
            } else {
                null
            }

            val inner = when {
                headerInput != null && mdatInput != null -> SequenceInputStream(headerInput, mdatInput)
                headerInput != null -> headerInput
                mdatInput != null -> mdatInput
                else -> ByteArrayInputStream(ByteArray(0))
            }
            return LeaseClosingInputStream(inner, lease)
        }

        private fun openDecryptedMdat(
            stream: StreamSession,
            relativeStart: Long,
            relativeEnd: Long,
        ): InputStream {
            val sourceStart = stream.decoder.mdatFileOffset + relativeStart
            val sourceEnd = stream.decoder.mdatFileOffset + relativeEnd
            val response = client.newCall(
                upstreamRequest(stream.src, stream.headers, "bytes=$sourceStart-$sourceEnd"),
            ).execute()
            if (response.code != 200 && response.code != 206) {
                response.close()
                throw IllegalStateException("upstream returned HTTP ${response.code}")
            }
            if (response.code == 206) {
                try {
                    verifyContentRangeStart(response.header("Content-Range"), sourceStart)
                } catch (error: Throwable) {
                    response.close()
                    throw error
                }
            }
            val body = response.body ?: run {
                response.close()
                throw IllegalStateException("upstream returned an empty body")
            }
            val input = body.byteStream()
            if (response.code == 200 && sourceStart > 0L) {
                try {
                    ensureAllowedRangeSkip(sourceStart)
                    skipFully(input, sourceStart)
                } catch (error: Throwable) {
                    response.close()
                    throw error
                }
            }
            return DecryptingInputStream(
                response,
                input,
                stream.decoder,
                relativeStart,
                relativeEnd - relativeStart + 1L,
            )
        }

        private fun parseToken(uri: String): String {
            val match = Regex("^/l/([0-9a-fA-F]{32})(?:\\.m4a)?$").matchEntire(uri)
            return requireNotNull(match) { "invalid CENC proxy path" }.groupValues[1]
        }

        private fun parseRange(header: String?, total: Long): ByteRange? {
            if (header == null) return null
            val match = Regex("^bytes=(\\d*)-(\\d*)$").matchEntire(header.trim()) ?: return null
            val startText = match.groupValues[1]
            val endText = match.groupValues[2]
            if (startText.isEmpty() && endText.isEmpty()) return null

            val start: Long
            val end: Long
            if (startText.isEmpty()) {
                val suffixLength = endText.toLongOrNull() ?: return null
                if (suffixLength <= 0L) return null
                start = max(0L, total - suffixLength)
                end = total - 1L
            } else {
                start = startText.toLongOrNull() ?: return null
                end = if (endText.isEmpty()) total - 1L else min(
                    endText.toLongOrNull() ?: return null,
                    total - 1L,
                )
            }
            if (start < 0L || start >= total || start > end) return null
            return ByteRange(start, end)
        }
    }

    private class LeaseClosingInputStream(
        private val delegate: InputStream,
        private val lease: StreamLease,
    ) : InputStream() {
        override fun read(): Int = delegate.read()

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            delegate.read(buffer, offset, length)

        override fun close() {
            try {
                delegate.close()
            } finally {
                lease.close()
            }
        }
    }

    private class DecryptingInputStream(
        private val response: OkHttpResponse,
        private val input: InputStream,
        private val decoder: CencStreamDecoder,
        private var relativeOffset: Long,
        private var remaining: Long,
    ) : InputStream() {
        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0L) return -1
            val requested = min(length.toLong(), remaining).toInt()
            val read = input.read(buffer, offset, requested)
            if (read <= 0) return -1
            decoder.decrypt(relativeOffset, buffer, offset, read)
            relativeOffset += read
            remaining -= read
            return read
        }

        override fun close() {
            try {
                input.close()
            } finally {
                response.close()
            }
        }
    }

    private fun skipFully(input: InputStream, count: Long) {
        var remaining = count
        val scratch = ByteArray(64 * 1024)
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
                continue
            }
            val read = input.read(scratch, 0, min(scratch.size.toLong(), remaining).toInt())
            require(read >= 0) { "upstream ended while seeking to byte $count" }
            remaining -= read
        }
    }

    private fun readUInt32(data: ByteArray, offset: Int): Long {
        return ((data[offset].toLong() and 0xffL) shl 24) or
            ((data[offset + 1].toLong() and 0xffL) shl 16) or
            ((data[offset + 2].toLong() and 0xffL) shl 8) or
            (data[offset + 3].toLong() and 0xffL)
    }

    private fun readUInt64(data: ByteArray, offset: Int): Long {
        val high = readUInt32(data, offset)
        val low = readUInt32(data, offset + 4)
        require(high <= Int.MAX_VALUE.toLong()) { "MP4 box is too large" }
        return (high shl 32) or low
    }

    private fun String.hexToByteArray(): ByteArray {
        return ByteArray(length / 2) { index ->
            substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }
}
