package `fun`.upup.musicfree.download

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.security.MessageDigest
import java.util.Properties
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class DownloadExecutor(private val client: OkHttpClient) {

    class ExecutionControl {
        val paused = AtomicBoolean(false)
        val canceled = AtomicBoolean(false)
        val callRef = AtomicReference<okhttp3.Call?>(null)

        fun cancel() {
            canceled.set(true)
            callRef.get()?.cancel()
        }

        fun pause() {
            paused.set(true)
            callRef.get()?.cancel()
        }
    }

    data class ExecutionResult(
        val finalStatus: DownloadTaskStatus,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val errorMessage: String? = null,
    )

    private data class PartialMeta(
        val resourceHash: String,
        val strongEtag: String,
        val lastModified: String,
        val totalBytes: Long,
    )

    private data class ParsedContentRange(
        val start: Long,
        val end: Long,
        val total: Long?,
    )

    fun execute(
        task: DownloadTask,
        control: ExecutionControl,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): ExecutionResult {
        val destinationFile = File(task.destinationPath)
        return withDestinationLock(destinationFile.absolutePath) {
            executeAttempt(
                task = task,
                destinationFile = destinationFile,
                control = control,
                onProgress = onProgress,
                allowRestart = true,
            )
        }
    }

    private fun executeAttempt(
        task: DownloadTask,
        destinationFile: File,
        control: ExecutionControl,
        onProgress: (downloaded: Long, total: Long) -> Unit,
        allowRestart: Boolean,
    ): ExecutionResult {
        val parent = destinationFile.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            return ExecutionResult(
                finalStatus = DownloadTaskStatus.ERROR,
                downloadedBytes = task.downloadedBytes,
                totalBytes = task.totalBytes,
                errorMessage = "Failed to create parent directory",
            )
        }

        val metaFile = File("${destinationFile.absolutePath}.meta")
        return try {
            val initialExistingSize = if (destinationFile.exists()) destinationFile.length() else 0L
            if (control.canceled.get()) {
                return ExecutionResult(
                    finalStatus = DownloadTaskStatus.CANCELED,
                    downloadedBytes = initialExistingSize,
                    totalBytes = task.totalBytes,
                )
            }
            if (control.paused.get()) {
                return ExecutionResult(
                    finalStatus = DownloadTaskStatus.PAUSED,
                    downloadedBytes = initialExistingSize,
                    totalBytes = task.totalBytes,
                )
            }

            val currentResourceHash = canonicalResourceHash(task.url)
            var existingSize = initialExistingSize
            var meta = if (existingSize > 0L) readMeta(metaFile) else null
            val hasResumeValidator = meta != null &&
                currentResourceHash.isNotEmpty() &&
                meta.resourceHash == currentResourceHash &&
                (meta.strongEtag.isNotEmpty() || meta.lastModified.isNotEmpty())
            if (existingSize > 0L && !hasResumeValidator) {
                deletePartialAndMeta(
                    destinationFile = destinationFile,
                    metaFile = metaFile,
                    failureMessage = "Failed to delete unverified partial file",
                )
                existingSize = 0L
                meta = null
            } else if (existingSize <= 0L && metaFile.exists()) {
                runCatching { metaFile.delete() }
            }

            val headersBuilder = Headers.Builder()
            var callerProvidedIfRange = false
            task.headers.forEach { (key, value) ->
                if (key.equals("If-Range", ignoreCase = true)) {
                    callerProvidedIfRange = true
                }
                headersBuilder.add(key, value)
            }
            if (existingSize > 0L && meta != null) {
                headersBuilder.add("Range", "bytes=$existingSize-")
                if (!callerProvidedIfRange) {
                    val validator = meta.strongEtag.ifEmpty { meta.lastModified }
                    if (validator.isNotEmpty()) {
                        headersBuilder.add("If-Range", validator)
                    }
                }
            }

            val request = Request.Builder()
                .url(task.url)
                .headers(headersBuilder.build())
                .get()
                .build()

            val call = client.newCall(request)
            control.callRef.set(call)
            if (control.canceled.get()) {
                call.cancel()
                control.callRef.set(null)
                return ExecutionResult(
                    finalStatus = DownloadTaskStatus.CANCELED,
                    downloadedBytes = existingSize,
                    totalBytes = task.totalBytes,
                )
            }
            if (control.paused.get()) {
                call.cancel()
                control.callRef.set(null)
                return ExecutionResult(
                    finalStatus = DownloadTaskStatus.PAUSED,
                    downloadedBytes = existingSize,
                    totalBytes = task.totalBytes,
                )
            }

            var restartFromScratch = false
            val attemptResult: ExecutionResult? = call.execute().use responseScope@{ response ->
                val rawRespEtag = response.header("ETag")?.trim().orEmpty()
                val respStrongEtag = extractStrongEtag(rawRespEtag)
                val respLastModified = response.header("Last-Modified")?.trim().orEmpty()

                if (response.code == 416 && existingSize > 0L) {
                    val totalFromRange = parseContentRangeTotal(response.header("Content-Range"))
                    val validatorMatched = meta != null &&
                        meta.totalBytes > 0L &&
                        totalFromRange != null &&
                        totalFromRange == meta.totalBytes &&
                        existingSize == totalFromRange &&
                        (
                            (meta.strongEtag.isNotEmpty() && respStrongEtag == meta.strongEtag) ||
                                (
                                    meta.strongEtag.isEmpty() &&
                                        meta.lastModified.isNotEmpty() &&
                                        respLastModified == meta.lastModified
                                    )
                            )
                    control.callRef.set(null)
                    if (validatorMatched) {
                        runCatching { metaFile.delete() }
                        return@responseScope ExecutionResult(
                            finalStatus = DownloadTaskStatus.COMPLETED,
                            downloadedBytes = existingSize,
                            totalBytes = totalFromRange!!,
                        )
                    }
                    if (!allowRestart) {
                        throw IOException("HTTP 416 unverified partial after retry")
                    }
                    restartFromScratch = true
                    return@responseScope null
                }

                if (!response.isSuccessful) {
                    control.callRef.set(null)
                    throw IOException("HTTP ${response.code}")
                }

                val contentRange = response.header("Content-Range")
                if (response.code == 206) {
                    if (existingSize <= 0L) {
                        val range = parseContentRange(contentRange)
                        if (range == null || range.start != 0L) {
                            control.callRef.set(null)
                            throw IOException("Unexpected HTTP 206 without Range request")
                        }
                    } else {
                        val range = parseContentRange(contentRange)
                        val validOffsets = range != null &&
                            range.start == existingSize &&
                            range.end >= range.start &&
                            (range.total == null || (range.total > 0L && range.end == range.total - 1L))
                        if (!validOffsets) {
                            control.callRef.set(null)
                            throw IOException("Invalid Content-Range for resume")
                        }
                        val parsedTotal = range!!.total
                        val totalMismatch = meta != null &&
                            meta.totalBytes > 0L &&
                            parsedTotal != null &&
                            parsedTotal != meta.totalBytes
                        val etagMismatch = meta != null &&
                            meta.strongEtag.isNotEmpty() &&
                            rawRespEtag.isNotEmpty() &&
                            respStrongEtag != meta.strongEtag
                        val lastModMismatch = meta != null &&
                            meta.strongEtag.isEmpty() &&
                            meta.lastModified.isNotEmpty() &&
                            respLastModified.isNotEmpty() &&
                            respLastModified != meta.lastModified
                        if (totalMismatch || etagMismatch || lastModMismatch) {
                            control.callRef.set(null)
                            if (!allowRestart) {
                                throw IOException("Representation changed during resume")
                            }
                            restartFromScratch = true
                            return@responseScope null
                        }
                    }
                }

                val body = response.body ?: throw IOException("Empty body")
                val responseBodyLength = body.contentLength()
                val shouldAppend = existingSize > 0L && response.code == 206
                val totalBytes = calculateTotalBytes(
                    existingSize = existingSize,
                    responseCode = response.code,
                    contentLength = responseBodyLength,
                    contentRange = contentRange,
                )

                var downloaded = if (shouldAppend) existingSize else 0L
                if (control.canceled.get()) {
                    control.callRef.set(null)
                    return@responseScope ExecutionResult(
                        finalStatus = DownloadTaskStatus.CANCELED,
                        downloadedBytes = existingSize,
                        totalBytes = totalBytes,
                    )
                }
                if (control.paused.get()) {
                    control.callRef.set(null)
                    return@responseScope ExecutionResult(
                        finalStatus = DownloadTaskStatus.PAUSED,
                        downloadedBytes = existingSize,
                        totalBytes = totalBytes,
                    )
                }

                val nextStrongEtag = if (shouldAppend) {
                    respStrongEtag.ifEmpty { meta?.strongEtag.orEmpty() }
                } else {
                    respStrongEtag
                }
                val nextLastModified = if (shouldAppend) {
                    respLastModified.ifEmpty { meta?.lastModified.orEmpty() }
                } else {
                    respLastModified
                }
                if (
                    currentResourceHash.isNotEmpty() &&
                    (nextStrongEtag.isNotEmpty() || nextLastModified.isNotEmpty())
                ) {
                    writeMeta(
                        metaFile = metaFile,
                        meta = PartialMeta(
                            resourceHash = currentResourceHash,
                            strongEtag = nextStrongEtag,
                            lastModified = nextLastModified,
                            totalBytes = totalBytes,
                        ),
                    )
                } else if (metaFile.exists()) {
                    runCatching { metaFile.delete() }
                }

                FileOutputStream(destinationFile, shouldAppend).use { fos ->
                    BufferedOutputStream(fos).use { bos ->
                        body.byteStream().use { input ->
                            BufferedInputStream(input).use { bis ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    if (control.canceled.get()) {
                                        return@responseScope ExecutionResult(
                                            finalStatus = DownloadTaskStatus.CANCELED,
                                            downloadedBytes = downloaded,
                                            totalBytes = totalBytes,
                                        )
                                    }
                                    if (control.paused.get()) {
                                        bos.flush()
                                        runCatching { fos.fd.sync() }
                                        return@responseScope ExecutionResult(
                                            finalStatus = DownloadTaskStatus.PAUSED,
                                            downloadedBytes = downloaded,
                                            totalBytes = totalBytes,
                                        )
                                    }

                                    val read = bis.read(buffer)
                                    if (read <= 0) {
                                        break
                                    }
                                    bos.write(buffer, 0, read)
                                    downloaded += read
                                    onProgress(downloaded, totalBytes)
                                }
                                bos.flush()
                                runCatching { fos.fd.sync() }
                            }
                        }
                    }
                }

                control.callRef.set(null)
                if (totalBytes > 0L && downloaded != totalBytes) {
                    return@responseScope ExecutionResult(
                        finalStatus = DownloadTaskStatus.ERROR,
                        downloadedBytes = downloaded,
                        totalBytes = totalBytes,
                        errorMessage = "Incomplete or mismatched download: $downloaded / $totalBytes",
                    )
                }
                runCatching { metaFile.delete() }
                ExecutionResult(
                    finalStatus = DownloadTaskStatus.COMPLETED,
                    downloadedBytes = downloaded,
                    totalBytes = totalBytes,
                )
            }

            if (restartFromScratch) {
                deletePartialAndMeta(
                    destinationFile = destinationFile,
                    metaFile = metaFile,
                    failureMessage = "Failed to delete stale partial before retry",
                )
                return executeAttempt(
                    task = task,
                    destinationFile = destinationFile,
                    control = control,
                    onProgress = onProgress,
                    allowRestart = false,
                )
            }

            attemptResult ?: ExecutionResult(
                finalStatus = DownloadTaskStatus.ERROR,
                downloadedBytes = if (destinationFile.exists()) destinationFile.length() else task.downloadedBytes,
                totalBytes = task.totalBytes,
                errorMessage = "Empty execution result",
            )
        } catch (error: Exception) {
            val canceled = control.canceled.get()
            val paused = control.paused.get()
            val status = when {
                canceled -> DownloadTaskStatus.CANCELED
                paused -> DownloadTaskStatus.PAUSED
                else -> DownloadTaskStatus.ERROR
            }
            ExecutionResult(
                finalStatus = status,
                downloadedBytes = if (destinationFile.exists()) destinationFile.length() else task.downloadedBytes,
                totalBytes = task.totalBytes,
                errorMessage = error.message ?: "unknown error",
            )
        } finally {
            control.callRef.set(null)
        }
    }

    private fun deletePartialAndMeta(
        destinationFile: File,
        metaFile: File,
        failureMessage: String,
    ) {
        runCatching { metaFile.delete() }
        if (destinationFile.exists() && !destinationFile.delete()) {
            throw IOException(failureMessage)
        }
    }

    private fun readMeta(metaFile: File): PartialMeta? {
        if (!metaFile.isFile) return null
        return try {
            val props = Properties()
            FileInputStream(metaFile).use { props.load(it) }
            val resourceHash = props.getProperty("resourceHash", "").trim()
            if (resourceHash.isEmpty()) return null
            PartialMeta(
                resourceHash = resourceHash,
                strongEtag = props.getProperty("strongEtag", "").trim(),
                lastModified = props.getProperty("lastModified", "").trim(),
                totalBytes = props.getProperty("totalBytes", "-1").trim().toLongOrNull() ?: -1L,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun writeMeta(metaFile: File, meta: PartialMeta) {
        runCatching {
            val props = Properties().apply {
                setProperty("resourceHash", meta.resourceHash)
                setProperty("strongEtag", meta.strongEtag)
                setProperty("lastModified", meta.lastModified)
                setProperty("totalBytes", meta.totalBytes.toString())
            }
            FileOutputStream(metaFile, false).use { props.store(it, null) }
        }
    }

    private fun calculateTotalBytes(
        existingSize: Long,
        responseCode: Int,
        contentLength: Long,
        contentRange: String?,
    ): Long {
        if (contentRange != null) {
            val total = parseContentRangeTotal(contentRange)
            if (total != null && total > 0L) return total
        }

        if (contentLength <= 0L) {
            return -1L
        }

        return if (responseCode == 206 && existingSize > 0L) {
            existingSize + contentLength
        } else {
            contentLength
        }
    }

    private fun parseContentRange(contentRange: String?): ParsedContentRange? {
        if (contentRange.isNullOrBlank()) return null
        val match = CONTENT_RANGE_PATTERN.matchEntire(contentRange.trim()) ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val end = match.groupValues[2].toLongOrNull() ?: return null
        val rawTotal = match.groupValues[3]
        val total = if (rawTotal == "*") null else rawTotal.toLongOrNull() ?: return null
        return ParsedContentRange(start = start, end = end, total = total)
    }

    /** 解析 "bytes 0-99/1234" 或 416 场景的 "bytes 星/1234" 中的总长度 */
    private fun parseContentRangeTotal(contentRange: String?): Long? {
        if (contentRange.isNullOrBlank()) return null
        val slashIndex = contentRange.lastIndexOf('/')
        if (slashIndex <= 0 || slashIndex + 1 >= contentRange.length) return null
        return contentRange.substring(slashIndex + 1).trim().toLongOrNull()
    }

    companion object {
        private class PathLock(var refs: Int = 0)

        private val pathLocksGuard = Any()
        private val pathLocks = HashMap<String, PathLock>()

        private val CONTENT_RANGE_PATTERN = Regex(
            pattern = """bytes\s+(\d+)-(\d+)/(\d+|\*)""",
            option = RegexOption.IGNORE_CASE,
        )

        private inline fun <T> withDestinationLock(path: String, block: () -> T): T {
            val lock = synchronized(pathLocksGuard) {
                pathLocks.getOrPut(path) { PathLock() }.also { it.refs += 1 }
            }
            return try {
                synchronized(lock) { block() }
            } finally {
                synchronized(pathLocksGuard) {
                    lock.refs -= 1
                    if (lock.refs <= 0) {
                        pathLocks.remove(path)
                    }
                }
            }
        }

        internal fun extractStrongEtag(rawEtag: String?): String {
            val trimmed = rawEtag?.trim().orEmpty()
            if (trimmed.isEmpty() || trimmed.startsWith("W/", ignoreCase = true)) {
                return ""
            }
            return trimmed
        }

        internal fun canonicalResourceHash(rawUrl: String): String {
            return try {
                val uri = URI(rawUrl.trim())
                val scheme = uri.scheme?.lowercase() ?: return ""
                if (scheme != "http" && scheme != "https") return ""
                val host = uri.host?.lowercase() ?: return ""
                val port = if (uri.port > 0) uri.port else if (scheme == "https") 443 else 80
                val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
                val canonical = "$scheme://$host:$port$path"
                val digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toByteArray(Charsets.UTF_8))
                buildString(digest.size * 2) {
                    for (byte in digest) {
                        append(((byte.toInt() ushr 4) and 0x0f).toString(16))
                        append((byte.toInt() and 0x0f).toString(16))
                    }
                }
            } catch (_: Exception) {
                ""
            }
        }
    }
}
