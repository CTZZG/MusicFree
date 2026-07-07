package `fun`.upup.musicfree.download

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
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

    fun execute(
        task: DownloadTask,
        control: ExecutionControl,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): ExecutionResult {
        val destinationFile = File(task.destinationPath)
        val parent = destinationFile.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            return ExecutionResult(
                finalStatus = DownloadTaskStatus.ERROR,
                downloadedBytes = task.downloadedBytes,
                totalBytes = task.totalBytes,
                errorMessage = "Failed to create parent directory",
            )
        }

        val existingSize = if (destinationFile.exists()) destinationFile.length() else 0L
        val headersBuilder = Headers.Builder()
        task.headers.forEach { (key, value) ->
            headersBuilder.add(key, value)
        }
        if (existingSize > 0) {
            headersBuilder.add("Range", "bytes=$existingSize-")
        }

        val request = Request.Builder()
            .url(task.url)
            .headers(headersBuilder.build())
            .get()
            .build()

        return try {
            val call = client.newCall(request)
            control.callRef.set(call)
            val response = call.execute()
            if (response.code == 416 && existingSize > 0) {
                // Range 起点不小于文件总长：要么本地文件其实已完整，要么残片与
                // 远端不匹配（例如同名残留），删除后全量重下
                val totalFromRange = parseContentRangeTotal(response.header("Content-Range"))
                control.callRef.set(null)
                response.close()
                if (totalFromRange != null && totalFromRange > 0 && existingSize == totalFromRange) {
                    return ExecutionResult(
                        finalStatus = DownloadTaskStatus.COMPLETED,
                        downloadedBytes = existingSize,
                        totalBytes = totalFromRange,
                    )
                }
                if (destinationFile.exists() && !destinationFile.delete()) {
                    throw IOException("HTTP 416 and failed to delete stale file")
                }
                return execute(task, control, onProgress)
            }
            if (!response.isSuccessful) {
                control.callRef.set(null)
                response.close()
                throw IOException("HTTP ${response.code}")
            }

            val contentRange = response.header("Content-Range")
            if (response.code == 206) {
                val rangeStart = parseContentRangeStart(contentRange)
                if (rangeStart == null || rangeStart != existingSize) {
                    control.callRef.set(null)
                    response.close()
                    throw IOException("Invalid Content-Range for resume")
                }
            }

            val body = response.body ?: throw IOException("Empty body")
            val responseBodyLength = body.contentLength()
            val shouldAppend = existingSize > 0 && response.code == 206
            val totalBytes = calculateTotalBytes(
                existingSize = existingSize,
                responseCode = response.code,
                contentLength = responseBodyLength,
                contentRange = contentRange,
            )

            var downloaded = if (shouldAppend) existingSize else 0L
            val outFileStream = FileOutputStream(destinationFile, shouldAppend)
            body.byteStream().use { input ->
                BufferedInputStream(input).use { bis ->
                    outFileStream.use { fos ->
                        BufferedOutputStream(fos).use { bos ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                if (control.canceled.get()) {
                                    return ExecutionResult(
                                        finalStatus = DownloadTaskStatus.CANCELED,
                                        downloadedBytes = downloaded,
                                        totalBytes = totalBytes,
                                    )
                                }
                                if (control.paused.get()) {
                                    return ExecutionResult(
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
                        }
                    }
                }
            }

            control.callRef.set(null)
            response.close()
            if (totalBytes > 0L && downloaded < totalBytes) {
                return ExecutionResult(
                    finalStatus = DownloadTaskStatus.ERROR,
                    downloadedBytes = downloaded,
                    totalBytes = totalBytes,
                    errorMessage = "Incomplete download: $downloaded / $totalBytes",
                )
            }
            ExecutionResult(
                finalStatus = DownloadTaskStatus.COMPLETED,
                downloadedBytes = downloaded,
                totalBytes = totalBytes,
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

    private fun calculateTotalBytes(
        existingSize: Long,
        responseCode: Int,
        contentLength: Long,
        contentRange: String?,
    ): Long {
        if (contentRange != null) {
            val slashIndex = contentRange.lastIndexOf('/')
            if (slashIndex > 0 && slashIndex + 1 < contentRange.length) {
                val total = contentRange.substring(slashIndex + 1).toLongOrNull()
                if (total != null) return total
            }
        }

        if (contentLength <= 0) {
            return -1L
        }

        return if (responseCode == 206 && existingSize > 0) {
            existingSize + contentLength
        } else {
            contentLength
        }
    }

    private fun parseContentRangeStart(contentRange: String?): Long? {
        if (contentRange.isNullOrBlank()) return null
        val match = CONTENT_RANGE_PATTERN.matchEntire(contentRange.trim()) ?: return null
        return match.groupValues[1].toLongOrNull()
    }

    /** 解析 "bytes 0-99/1234" 或 416 场景的 "bytes 星/1234" 中的总长度 */
    private fun parseContentRangeTotal(contentRange: String?): Long? {
        if (contentRange.isNullOrBlank()) return null
        val slashIndex = contentRange.lastIndexOf('/')
        if (slashIndex <= 0 || slashIndex + 1 >= contentRange.length) return null
        return contentRange.substring(slashIndex + 1).trim().toLongOrNull()
    }

    companion object {
        private val CONTENT_RANGE_PATTERN = Regex(
            pattern = """bytes\s+(\d+)-(\d+)/(\d+|\*)""",
            option = RegexOption.IGNORE_CASE,
        )
    }
}
