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
import java.io.EOFException
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
        Regex("""^bytes\s+(\d+)-(\d+)/(\d+|\*)$""", RegexOption.IGNORE_CASE)

    private val registry = SessionRegistry()
    private val lifecycle = ProxyLifecycle()
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
        val upstreamTotalSize: Long? = null,
    )

    internal class ProxyLifecycle {
        private val lock = Any()
        private var nextOwnerId = 1L
        private var generation = 1L
        private val activeOwners = LinkedHashSet<Long>()

        fun attachOwner(): Long = synchronized(lock) {
            val id = nextOwnerId++
            activeOwners.add(id)
            id
        }

        fun detachOwner(ownerId: Long, onLastOwnerDetached: () -> Unit) {
            val shouldShutdown = synchronized(lock) {
                val removed = activeOwners.remove(ownerId)
                if (removed && activeOwners.isEmpty()) {
                    generation += 1L
                    true
                } else {
                    false
                }
            }
            if (shouldShutdown) {
                onLastOwnerDetached()
            }
        }

        fun snapshotForRegistration(ownerId: Long?): Long = synchronized(lock) {
            if (ownerId != null && !activeOwners.contains(ownerId)) {
                throw IllegalStateException("CENC proxy owner is no longer active")
            }
            generation
        }

        fun advanceGeneration() {
            synchronized(lock) {
                activeOwners.clear()
                generation += 1L
            }
        }

        fun <T> commitRegistration(
            ownerId: Long?,
            expectedGeneration: Long,
            onRejected: () -> Unit,
            block: () -> T,
        ): T {
            synchronized(lock) {
                val ownerActive = ownerId == null || activeOwners.contains(ownerId)
                if (!ownerActive || generation != expectedGeneration) {
                    onRejected()
                    throw IllegalStateException("CENC proxy lifecycle ended during stream registration")
                }
                return block()
            }
        }
    }

    internal class StreamSession(
        val token: String,
        val src: String,
        val headers: Map<String, String>,
        val decoder: CencStreamDecoder,
        val upstreamTotalSize: Long? = null,
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
            upstreamTotalSize: Long? = null,
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
                        upstreamTotalSize = upstreamTotalSize,
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

    fun attachOwner(): Long = lifecycle.attachOwner()

    fun detachOwner(ownerId: Long) {
        lifecycle.detachOwner(ownerId, ::stopServerAndClear)
    }

    fun register(src: String, cek: String, headers: Map<String, String>): String =
        registerInternal(ownerId = null, src = src, cek = cek, headers = headers)

    fun register(ownerId: Long, src: String, cek: String, headers: Map<String, String>): String =
        registerInternal(ownerId = ownerId, src = src, cek = cek, headers = headers)

    private fun registerInternal(
        ownerId: Long?,
        src: String,
        cek: String,
        headers: Map<String, String>,
    ): String {
        val expectedGeneration = lifecycle.snapshotForRegistration(ownerId)
        PublicHttpsNetworkPolicy.requirePublicRemote(src)
        val normalizedCek = cek.trim()
        require(normalizedCek.matches(Regex("^[0-9a-fA-F]{32}$"))) {
            "invalid cek (expected 32 hexadecimal characters)"
        }

        val layout = discoverLayout(src, headers)
        val decoder = CencDecoder(
            layout.ftyp,
            layout.moov,
            normalizedCek.hexToByteArray(),
            layout.mdatPayloadOffset,
            layout.mdatPayloadSize,
        )
        val token = UUID.randomUUID().toString().replace("-", "")
        return lifecycle.commitRegistration(
            ownerId = ownerId,
            expectedGeneration = expectedGeneration,
            onRejected = { runCatching { decoder.close() } },
        ) {
            try {
                val baseUrl = ensureStarted()
                registry.register(token, src, headers, decoder, layout.upstreamTotalSize)
                "$baseUrl/l/$token.m4a"
            } catch (error: Throwable) {
                runCatching { decoder.close() }
                throw error
            }
        }
    }

    fun shutdown() {
        lifecycle.advanceGeneration()
        stopServerAndClear()
    }

    private fun stopServerAndClear() {
        synchronized(this) {
            server?.stop()
            server = null
        }
        registry.clear()
    }

    internal fun verifyContentRangeStart(
        contentRange: String?,
        expectedStart: Long,
        expectedMinEnd: Long? = null,
        expectedTotal: Long? = null,
    ) {
        val header = contentRange?.trim()
            ?: throw IllegalStateException("Unexpected Content-Range: missing header")
        val match = contentRangeRegex.matchEntire(header)
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        val actualStart = match.groupValues[1].toLongOrNull()
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        val actualEnd = match.groupValues[2].toLongOrNull()
            ?: throw IllegalStateException("Unexpected Content-Range: $header")
        val totalToken = match.groupValues[3]
        if (actualStart != expectedStart || actualEnd < actualStart) {
            throw IllegalStateException("Unexpected Content-Range: $header (expected start $expectedStart)")
        }
        if (expectedMinEnd != null && actualEnd < expectedMinEnd) {
            throw IllegalStateException("Unexpected Content-Range end: $header (expected end >= $expectedMinEnd)")
        }
        if (totalToken != "*") {
            val actualTotal = totalToken.toLongOrNull()
                ?: throw IllegalStateException("Unexpected Content-Range total: $header")
            if (actualEnd >= actualTotal) {
                throw IllegalStateException("Unexpected Content-Range bounds: $header")
            }
            if (expectedTotal != null && actualTotal != expectedTotal) {
                throw IllegalStateException(
                    "Upstream CENC representation size changed ($actualTotal != $expectedTotal)",
                )
            }
        }
    }

    internal fun ensureAllowedRangeSkip(skipBytes: Long) {
        if (skipBytes > MAX_IGNORED_RANGE_SKIP) {
            throw IllegalStateException("Upstream ignored Range for large offset ($skipBytes bytes)")
        }
    }

    private fun discoverLayout(src: String, headers: Map<String, String>): Layout {
        val first = fetchRange(src, headers, 0L, PROBE_SIZE.toLong() - 1L)
        val knownTotal = first.totalSize
        val totalSize = knownTotal ?: first.body.size.toLong()
        require(totalSize >= 8L) { "upstream CENC file is empty or truncated" }

        var ftyp: ByteArray? = null
        var moov: ByteArray? = null
        var mdatPayloadOffset: Long? = null
        var mdatPayloadSize: Long? = null
        var offset = 0L
        var guard = 0

        while (offset + 8L <= totalSize && guard++ < 4096) {
            val headerLen = min(16L, totalSize - offset).toInt()
            val headerBytes = bytesAt(src, headers, offset, headerLen, first.body, knownTotal)
            val box = parseBoxHeader(headerBytes, totalSize - offset)
                ?: throw IllegalArgumentException("invalid MP4 box at offset $offset")
            require(box.size >= box.headerSize) { "invalid ${box.type} box size" }

            when (box.type) {
                "ftyp" -> ftyp = bytesAt(src, headers, offset, checkedBoxSize(box), first.body, knownTotal)
                "moov" -> moov = bytesAt(src, headers, offset, checkedBoxSize(box), first.body, knownTotal)
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
            knownTotal,
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
        expectedTotal: Long?,
    ): ByteArray {
        require(length >= 0)
        if (length == 0) return ByteArray(0)
        if (offset >= 0L && offset + length <= initialCache.size.toLong()) {
            return initialCache.copyOfRange(offset.toInt(), offset.toInt() + length)
        }
        val result = fetchRange(
            src = src,
            headers = headers,
            start = offset,
            end = offset + length - 1L,
            expectedTotal = expectedTotal,
        ).body
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
        expectedTotal: Long? = null,
    ): RangeResult {
        require(start >= 0L && end >= start)
        val request = upstreamRequest(src, headers, "bytes=$start-$end")
        client.newCall(request).execute().use { response ->
            require(response.code == 200 || response.code == 206) {
                "upstream returned HTTP ${response.code}"
            }
            if (response.code == 206) {
                verifyContentRangeStart(
                    contentRange = response.header("Content-Range"),
                    expectedStart = start,
                    expectedTotal = expectedTotal,
                )
            }
            val total = parseTotalSize(response)
            if (expectedTotal != null && total != null && total != expectedTotal) {
                throw IllegalStateException(
                    "Upstream CENC representation size changed ($total != $expectedTotal)",
                )
            }
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
                    verifyContentRangeStart(
                        contentRange = response.header("Content-Range"),
                        expectedStart = sourceStart,
                        expectedMinEnd = sourceEnd,
                        expectedTotal = stream.upstreamTotalSize,
                    )
                } catch (error: Throwable) {
                    response.close()
                    throw error
                }
            } else {
                val total = parseTotalSize(response)
                if (stream.upstreamTotalSize != null && total != null && total != stream.upstreamTotalSize) {
                    response.close()
                    throw IllegalStateException(
                        "Upstream CENC representation size changed ($total != ${stream.upstreamTotalSize})",
                    )
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

    internal class DecryptingInputStream(
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
            if (length == 0) return 0
            if (remaining <= 0L) return -1
            val requested = min(length.toLong(), remaining).toInt()
            val read = input.read(buffer, offset, requested)
            if (read < 0) {
                throw EOFException("Upstream CENC stream ended prematurely ($remaining bytes remaining)")
            }
            if (read == 0) return 0
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
