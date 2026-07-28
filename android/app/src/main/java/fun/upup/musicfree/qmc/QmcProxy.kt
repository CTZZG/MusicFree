package `fun`.upup.musicfree.qmc

import fi.iki.elonen.NanoHTTPD
import `fun`.upup.musicfree.network.fixedLengthHeadResponse
import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy
import okhttp3.OkHttpClient
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

internal object QmcProxy {
    private const val MAX_SESSIONS = 128
    private const val SESSION_IDLE_TIMEOUT_MS = 5L * 60L * 1000L
    private const val SESSION_CLEANUP_INTERVAL_MS = 60L * 1000L

    private val sessions = QmcSessionRegistry<StreamSession>(
        maxSessions = MAX_SESSIONS,
        idleTimeoutMs = SESSION_IDLE_TIMEOUT_MS,
    )
    private val lifecycle = QmcProxyLifecycle()
    private val client = PublicHttpsNetworkPolicy.clientBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Volatile
    private var server: Server? = null
    @Volatile
    private var cleanupExecutor: ScheduledExecutorService? = null

    fun attachOwner(): Long = lifecycle.attachOwner()

    fun detachOwner(ownerId: Long) {
        lifecycle.detachOwner(ownerId, ::clearResources)
    }

    fun register(
        ownerId: Long,
        src: String,
        ekey: String?,
        headers: Map<String, String>,
    ): String {
        PublicHttpsNetworkPolicy.requirePublicRemote(src)
        val source = QmcRemoteSource(src, headers, client)
        val decoder = QmcDecoder.discover(source, ekey)
        return lifecycle.withActiveOwner(ownerId) {
            val proxyBaseUrl = ensureStarted()
            val token = UUID.randomUUID().toString().replace("-", "")
            sessions.register(token, StreamSession(
                source = source,
                decoder = decoder,
            ))
            "$proxyBaseUrl/l/$token.${decoder.info.extension}"
        }
    }

    fun inspect(
        src: String,
        ekey: String?,
        headers: Map<String, String>,
    ): QmcStreamInfo {
        PublicHttpsNetworkPolicy.requirePublicRemote(src)
        return QmcDecoder.discover(QmcRemoteSource(src, headers, client), ekey).info
    }

    @Synchronized
    private fun clearResources() {
        val currentExecutor = cleanupExecutor
        cleanupExecutor = null
        val currentServer = server
        server = null
        try {
            sessions.clear()
        } finally {
            currentExecutor?.shutdownNow()
            currentServer?.stop()
        }
    }

    @Synchronized
    private fun ensureStarted(): String {
        if (server == null) {
            server = Server().also { it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false) }
        }
        if (cleanupExecutor == null) {
            cleanupExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
                Thread(runnable, "MusicFree-QmcSessionCleanup").apply {
                    isDaemon = true
                }
            }.also { executor ->
                executor.scheduleWithFixedDelay(
                    { sessions.evictIdle() },
                    SESSION_CLEANUP_INTERVAL_MS,
                    SESSION_CLEANUP_INTERVAL_MS,
                    TimeUnit.MILLISECONDS,
                )
            }
        }
        val port = requireNotNull(server).listeningPort
        check(port > 0) { "QMC proxy did not obtain a listening port" }
        return "http://127.0.0.1:$port"
    }

    private data class StreamSession(
        val source: QmcRemoteSource,
        val decoder: QmcDecoder,
    )

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

                val token = parseQmcProxyToken(request.uri)
                    ?: return newFixedLengthResponse(
                        Response.Status.NOT_FOUND,
                        "text/plain",
                        "unknown stream",
                    )
                val lease = sessions.acquire(token) ?: return newFixedLengthResponse(
                    Response.Status.NOT_FOUND,
                    "text/plain",
                    "unknown stream",
                )
                var bodyOwnsLease = false
                try {
                    val session = lease.value
                    val total = session.decoder.info.audioSize
                    val rangeHeader = request.headers["range"]
                    val range = parseQmcHttpRange(rangeHeader, total)
                    if (rangeHeader != null && range == null) {
                        return newFixedLengthResponse(
                            Response.Status.RANGE_NOT_SATISFIABLE,
                            "text/plain",
                            "invalid range",
                        ).also { it.addHeader("Content-Range", "bytes */$total") }
                    }

                    val start = range?.start ?: 0L
                    val end = range?.end ?: total - 1L
                    val length = end - start + 1L
                    val status = if (range == null) {
                        Response.Status.OK
                    } else {
                        Response.Status.PARTIAL_CONTENT
                    }
                    val response = if (request.method == Method.HEAD) {
                        fixedLengthHeadResponse(
                            status,
                            session.decoder.info.contentType,
                            length,
                        )
                    } else {
                        val decrypted = DecryptingInputStream(
                            encrypted = session.source.openRange(start, end),
                            decrypt = session.decoder::decrypt,
                            absoluteOffset = start,
                            remaining = length,
                            onFinished = lease::close,
                        )
                        lease.attach(decrypted)
                        CloseOnSendResponse(
                            status,
                            session.decoder.info.contentType,
                            decrypted,
                            length,
                        ).also { bodyOwnsLease = true }
                    }
                    response.addHeader("Accept-Ranges", "bytes")
                    if (range != null) {
                        response.addHeader("Content-Range", "bytes $start-$end/$total")
                    }
                    response
                } finally {
                    if (!bodyOwnsLease) {
                        lease.close()
                    }
                }
            } catch (error: Exception) {
                newFixedLengthResponse(
                    Response.Status.INTERNAL_ERROR,
                    "text/plain",
                    error.message ?: "QMC proxy error",
                )
            }
        }

    }

}

internal open class CloseOnSendResponse(
    status: NanoHTTPD.Response.IStatus,
    mimeType: String,
    data: InputStream,
    totalBytes: Long,
) : NanoHTTPD.Response(status, mimeType, data, totalBytes) {
    protected override fun send(outputStream: OutputStream) {
        try {
            super.send(outputStream)
        } finally {
            close()
        }
    }
}

internal class DecryptingInputStream(
    private val encrypted: InputStream,
    private val decrypt: (ByteArray, Int, Int, Long) -> Unit,
    private var absoluteOffset: Long,
    private var remaining: Long,
    private val onFinished: () -> Unit,
) : InputStream() {
    private val closed = AtomicBoolean(false)

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) {
            close()
            return -1
        }
        return try {
            val requested = min(length.toLong(), remaining).toInt()
            val read = encrypted.read(buffer, offset, requested)
            if (read < 0) {
                close()
                -1
            } else {
                decrypt(buffer, offset, read, absoluteOffset)
                absoluteOffset += read
                remaining -= read
                if (remaining == 0L) close()
                read
            }
        } catch (error: Throwable) {
            try {
                close()
            } catch (closeError: Throwable) {
                error.addSuppressed(closeError)
            }
            throw error
        }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            try {
                encrypted.close()
            } finally {
                onFinished()
            }
        }
    }
}

private val QMC_TOKEN_PATH_PATTERN = Regex(
    "^/l/([0-9a-fA-F]{32})(?:\\.[a-zA-Z0-9]+)?$",
)

internal fun parseQmcProxyToken(uri: String): String? =
    QMC_TOKEN_PATH_PATTERN.matchEntire(uri)?.groupValues?.get(1)

internal data class QmcHttpByteRange(
    val start: Long,
    val end: Long,
)

internal fun parseQmcHttpRange(header: String?, total: Long): QmcHttpByteRange? {
    if (header == null || total <= 0L) return null
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
        end = if (endText.isEmpty()) {
            total - 1L
        } else {
            min(endText.toLongOrNull() ?: return null, total - 1L)
        }
    }
    if (start < 0L || start >= total || start > end) return null
    return QmcHttpByteRange(start, end)
}
