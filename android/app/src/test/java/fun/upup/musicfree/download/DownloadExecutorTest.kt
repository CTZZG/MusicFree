package `fun`.upup.musicfree.download

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class DownloadExecutorTest {
    private val servers = mutableListOf<MockWebServer>()
    private val loopbackAddress = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))

    @After
    fun tearDown() {
        servers.forEach { runCatching { it.shutdown() } }
    }

    @Test
    fun pauseMidStreamPreservesPartialFileAndResumesWithIfRange206() {
        val payload = ByteArray(256 * 1024) { idx -> (idx % 251).toByte() }
        val tempDir = Files.createTempDirectory("mf-dl-exec-").toFile()
        try {
            val destFile = File(tempDir, "track.part")
            val recordedIfRanges = CopyOnWriteArrayList<String?>()
            val dynamicServer = newServer()
            dynamicServer.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val range = request.getHeader("Range")
                    if (range == null) {
                        return MockResponse()
                            .setResponseCode(200)
                            .setHeader("ETag", "\"song-v1\"")
                            .setHeader("Content-Length", payload.size.toString())
                            .setBody(Buffer().write(payload))
                            .throttleBody(32 * 1024L, 80, TimeUnit.MILLISECONDS)
                    }
                    recordedIfRanges += request.getHeader("If-Range")
                    val start = range.removePrefix("bytes=").removeSuffix("-").toInt()
                    return MockResponse()
                        .setResponseCode(206)
                        .setHeader("ETag", "\"song-v1\"")
                        .setHeader("Content-Range", "bytes $start-${payload.size - 1}/${payload.size}")
                        .setHeader("Content-Length", (payload.size - start).toString())
                        .setBody(Buffer().write(payload, start, payload.size - start))
                }
            }

            val executor = DownloadExecutor(OkHttpClient())
            val task = DownloadTask(
                taskId = "t-1",
                url = dynamicServer.url("/song.mp3?token=t1").toString(),
                destinationPath = destFile.absolutePath,
            )

            val control1 = DownloadExecutor.ExecutionControl()
            val progressed = CountDownLatch(1)
            val result1 = executor.execute(task, control1) { downloaded, _ ->
                if (downloaded >= 32 * 1024L && progressed.count > 0) {
                    control1.pause()
                    progressed.countDown()
                }
            }

            assertEquals(DownloadTaskStatus.PAUSED, result1.finalStatus)
            assertTrue(destFile.exists())
            assertTrue(File("${destFile.absolutePath}.meta").exists())
            val partialLen = destFile.length()
            assertTrue(partialLen > 0L && partialLen < payload.size)

            // Rotated query signature on resume still matches canonical resource + strong ETag.
            val resumedTask = task.copy(url = dynamicServer.url("/song.mp3?token=t2").toString())
            val control2 = DownloadExecutor.ExecutionControl()
            val result2 = executor.execute(resumedTask, control2) { _, _ -> }

            assertEquals(DownloadTaskStatus.COMPLETED, result2.finalStatus)
            assertEquals(listOf("\"song-v1\""), recordedIfRanges.toList())
            assertEquals(payload.size.toLong(), destFile.length())
            assertArrayEquals(payload, destFile.readBytes())
            assertFalse(File("${destFile.absolutePath}.meta").exists())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun prePausedControlDoesNotTruncateExistingPartialFile() {
        val tempDir = Files.createTempDirectory("mf-dl-prepause-").toFile()
        try {
            val destFile = File(tempDir, "existing.part")
            val existing = byteArrayOf(10, 20, 30, 40, 50)
            destFile.writeBytes(existing)

            val server = newServer()
            server.enqueue(MockResponse().setResponseCode(200).setBody("overwrite"))

            val executor = DownloadExecutor(OkHttpClient())
            val task = DownloadTask(
                taskId = "t-2",
                url = server.url("/song.mp3").toString(),
                destinationPath = destFile.absolutePath,
            )
            val control = DownloadExecutor.ExecutionControl().apply { pause() }
            val result = executor.execute(task, control) { _, _ -> }

            assertEquals(DownloadTaskStatus.PAUSED, result.finalStatus)
            assertArrayEquals(existing, destFile.readBytes())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun resumeWithoutValidatorRestartsCleanlyFromZeroInsteadOfBlindRangeAppend() {
        val firstPayload = ByteArray(128 * 1024) { 1 }
        val replacementPayload = ByteArray(128 * 1024) { 2 }
        val tempDir = Files.createTempDirectory("mf-dl-novalidator-").toFile()
        try {
            val destFile = File(tempDir, "track.part")
            val seenRanges = CopyOnWriteArrayList<String?>()
            var callCount = 0
            val server = newServer()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    seenRanges += request.getHeader("Range")
                    callCount += 1
                    val body = if (callCount == 1) firstPayload else replacementPayload
                    return MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Length", body.size.toString())
                        .setBody(Buffer().write(body))
                        .apply {
                            if (callCount == 1) {
                                throttleBody(32 * 1024L, 80, TimeUnit.MILLISECONDS)
                            }
                        }
                }
            }

            val executor = DownloadExecutor(OkHttpClient())
            val task = DownloadTask(
                taskId = "t-noval",
                url = server.url("/dynamic.mp3").toString(),
                destinationPath = destFile.absolutePath,
            )

            val control1 = DownloadExecutor.ExecutionControl()
            val pausedLatch = CountDownLatch(1)
            val r1 = executor.execute(task, control1) { downloaded, _ ->
                if (downloaded >= 32 * 1024L && pausedLatch.count > 0) {
                    control1.pause()
                    pausedLatch.countDown()
                }
            }
            assertEquals(DownloadTaskStatus.PAUSED, r1.finalStatus)

            val r2 = executor.execute(task, DownloadExecutor.ExecutionControl()) { _, _ -> }
            assertEquals(DownloadTaskStatus.COMPLETED, r2.finalStatus)
            assertNull(seenRanges[1])
            assertArrayEquals(replacementPayload, destFile.readBytes())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun resumeRestartsFromZeroWhen206ValidatorOr416UnverifiedMismatches() {
        val v1Payload = ByteArray(128 * 1024) { 3 }
        val v2Payload = ByteArray(128 * 1024) { 7 }
        val tempDir = Files.createTempDirectory("mf-dl-mismatch-").toFile()
        try {
            val destFile = File(tempDir, "track.part")
            var step = 0
            val server = newServer()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    step += 1
                    return when (step) {
                        1 -> MockResponse()
                            .setResponseCode(200)
                            .setHeader("ETag", "\"v1\"")
                            .setHeader("Content-Length", v1Payload.size.toString())
                            .setBody(Buffer().write(v1Payload))
                            .throttleBody(32 * 1024L, 80, TimeUnit.MILLISECONDS)
                        2 -> {
                            // Broken server ignores If-Range and returns 206 with new ETag.
                            val start = request.getHeader("Range")!!
                                .removePrefix("bytes=").removeSuffix("-").toInt()
                            MockResponse()
                                .setResponseCode(206)
                                .setHeader("ETag", "\"v2\"")
                                .setHeader("Content-Range", "bytes $start-${v2Payload.size - 1}/${v2Payload.size}")
                                .setHeader("Content-Length", (v2Payload.size - start).toString())
                                .setBody(Buffer().write(v2Payload, start, v2Payload.size - start))
                        }
                        else -> MockResponse()
                            .setResponseCode(200)
                            .setHeader("ETag", "\"v2\"")
                            .setHeader("Content-Length", v2Payload.size.toString())
                            .setBody(Buffer().write(v2Payload))
                    }
                }
            }

            val executor = DownloadExecutor(OkHttpClient())
            val task = DownloadTask(
                taskId = "t-mismatch",
                url = server.url("/song.mp3").toString(),
                destinationPath = destFile.absolutePath,
            )
            val c1 = DownloadExecutor.ExecutionControl()
            val latch = CountDownLatch(1)
            executor.execute(task, c1) { downloaded, _ ->
                if (downloaded >= 32 * 1024L && latch.count > 0) {
                    c1.pause()
                    latch.countDown()
                }
            }

            val r2 = executor.execute(task, DownloadExecutor.ExecutionControl()) { _, _ -> }
            assertEquals(DownloadTaskStatus.COMPLETED, r2.finalStatus)
            assertArrayEquals(v2Payload, destFile.readBytes())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun http416WithoutMatchingValidatorReDownloadsInsteadOfFalseCompletion() {
        val tempDir = Files.createTempDirectory("mf-dl-416-").toFile()
        try {
            val destFile = File(tempDir, "stale.part")
            val staleBytes = ByteArray(64) { 9 }
            val freshBytes = ByteArray(64) { 5 }
            destFile.writeBytes(staleBytes)
            // Write meta with ETag v1, while server 416 replies with ETag v2 of identical length.
            File("${destFile.absolutePath}.meta").writeText(
                "resourceHash=${DownloadExecutor.canonicalResourceHash("http://127.0.0.1:80/a.mp3")}\n" +
                    "strongEtag=\"v1\"\ntotalBytes=64\n",
            )

            val server = newServer()
            val url = server.url("/a.mp3").toString()
            File("${destFile.absolutePath}.meta").writeText(
                "resourceHash=${DownloadExecutor.canonicalResourceHash(url)}\n" +
                    "strongEtag=\"v1\"\ntotalBytes=64\n",
            )
            server.enqueue(
                MockResponse()
                    .setResponseCode(416)
                    .setHeader("ETag", "\"v2\"")
                    .setHeader("Content-Range", "bytes */64"),
            )
            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .setHeader("ETag", "\"v2\"")
                    .setHeader("Content-Length", "64")
                    .setBody(Buffer().write(freshBytes)),
            )

            val executor = DownloadExecutor(OkHttpClient())
            val result = executor.execute(
                DownloadTask(taskId = "t-416", url = url, destinationPath = destFile.absolutePath),
                DownloadExecutor.ExecutionControl(),
            ) { _, _ -> }

            assertEquals(DownloadTaskStatus.COMPLETED, result.finalStatus)
            assertArrayEquals(freshBytes, destFile.readBytes())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun http416WithMatchingValidatorCompletesWithoutRedownloadAndDeletesMeta() {
        val tempDir = Files.createTempDirectory("mf-dl-416-ok-").toFile()
        try {
            val destFile = File(tempDir, "complete.part")
            val expectedBytes = ByteArray(96) { idx -> (idx + 1).toByte() }
            destFile.writeBytes(expectedBytes)

            val server = newServer()
            val url = server.url("/done.mp3").toString()
            val metaFile = File("${destFile.absolutePath}.meta")
            metaFile.writeText(
                "resourceHash=${DownloadExecutor.canonicalResourceHash(url)}\n" +
                    "strongEtag=\"v-done\"\ntotalBytes=96\n",
            )
            server.enqueue(
                MockResponse()
                    .setResponseCode(416)
                    .setHeader("ETag", "\"v-done\"")
                    .setHeader("Content-Range", "bytes */96"),
            )

            val executor = DownloadExecutor(OkHttpClient())
            val result = executor.execute(
                DownloadTask(taskId = "t-416-ok", url = url, destinationPath = destFile.absolutePath),
                DownloadExecutor.ExecutionControl(),
            ) { _, _ -> }

            assertEquals(DownloadTaskStatus.COMPLETED, result.finalStatus)
            assertEquals(96L, result.downloadedBytes)
            assertEquals(96L, result.totalBytes)
            assertEquals(1, server.requestCount)
            assertArrayEquals(expectedBytes, destFile.readBytes())
            assertFalse(metaFile.exists())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun http206WithUnknownTotalOrMismatchedBodyLengthFailsInsteadOfFalseCompletion() {
        val tempDir = Files.createTempDirectory("mf-dl-206-bounds-").toFile()
        try {
            val executor = DownloadExecutor(OkHttpClient())
            val server = newServer()

            // Case 1: Fresh request receives 206 with unknown total bytes 0-31/* -> must fail, not complete.
            val freshFile = File(tempDir, "fresh-unknown.part")
            val freshUrl = server.url("/fresh.mp3").toString()
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Range", "bytes 0-31/*")
                    .setHeader("Content-Length", "32")
                    .setBody(Buffer().write(ByteArray(32) { 1 })),
            )
            val freshResult = executor.execute(
                DownloadTask(taskId = "t-206-star-fresh", url = freshUrl, destinationPath = freshFile.absolutePath),
                DownloadExecutor.ExecutionControl(),
            ) { _, _ -> }
            assertEquals(DownloadTaskStatus.ERROR, freshResult.finalStatus)

            // Case 2: Resumed request receives 206 with unknown total bytes 32-63/* -> must fail, not complete.
            val resumeFile = File(tempDir, "resume-unknown.part")
            val resumeUrl = server.url("/resume.mp3").toString()
            resumeFile.writeBytes(ByteArray(32) { 2 })
            File("${resumeFile.absolutePath}.meta").writeText(
                "resourceHash=${DownloadExecutor.canonicalResourceHash(resumeUrl)}\n" +
                    "strongEtag=\"v1\"\ntotalBytes=-1\n",
            )
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setHeader("ETag", "\"v1\"")
                    .setHeader("Content-Range", "bytes 32-63/*")
                    .setBody(Buffer().write(ByteArray(32) { 3 })),
            )
            val resumeResult = executor.execute(
                DownloadTask(taskId = "t-206-star-resume", url = resumeUrl, destinationPath = resumeFile.absolutePath),
                DownloadExecutor.ExecutionControl(),
            ) { _, _ -> }
            assertEquals(DownloadTaskStatus.ERROR, resumeResult.finalStatus)
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun http200ReplacementDoesNotPairNewValidatorWithOldPartialWhenTruncateFails() {
        val tempDir = Files.createTempDirectory("mf-dl-200-meta-").toFile()
        try {
            val destFile = File(tempDir, "readonly.part")
            val oldPrefix = ByteArray(48) { 4 }
            val v2Payload = ByteArray(96) { 8 }
            destFile.writeBytes(oldPrefix)

            val server = newServer()
            val url = server.url("/replace.mp3").toString()
            val metaFile = File("${destFile.absolutePath}.meta")
            metaFile.writeText(
                "resourceHash=${DownloadExecutor.canonicalResourceHash(url)}\n" +
                    "strongEtag=\"v1\"\ntotalBytes=96\n",
            )
            assertTrue(destFile.setWritable(false))

            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .setHeader("ETag", "\"v2\"")
                    .setHeader("Content-Length", v2Payload.size.toString())
                    .setBody(Buffer().write(v2Payload)),
            )

            val executor = DownloadExecutor(OkHttpClient())
            val failed = executor.execute(
                DownloadTask(taskId = "t-200-ro", url = url, destinationPath = destFile.absolutePath),
                DownloadExecutor.ExecutionControl(),
            ) { _, _ -> }

            // If OS honors read-only file mode, open-for-truncate fails and v2 meta must NOT exist.
            if (failed.finalStatus == DownloadTaskStatus.ERROR) {
                assertFalse(metaFile.exists())
                assertArrayEquals(oldPrefix, destFile.readBytes())
                assertTrue(destFile.setWritable(true))

                server.enqueue(
                    MockResponse()
                        .setResponseCode(200)
                        .setHeader("ETag", "\"v2\"")
                        .setHeader("Content-Length", v2Payload.size.toString())
                        .setBody(Buffer().write(v2Payload)),
                )
                val recovered = executor.execute(
                    DownloadTask(taskId = "t-200-ro-retry", url = url, destinationPath = destFile.absolutePath),
                    DownloadExecutor.ExecutionControl(),
                ) { _, _ -> }
                assertEquals(DownloadTaskStatus.COMPLETED, recovered.finalStatus)
                assertArrayEquals(v2Payload, destFile.readBytes())
            } else {
                // Root container fallback where setWritable(false) is bypassed by CAP_DAC_OVERRIDE.
                assertEquals(DownloadTaskStatus.COMPLETED, failed.finalStatus)
                assertArrayEquals(v2Payload, destFile.readBytes())
            }
        } finally {
            File(tempDir, "readonly.part").setWritable(true)
            tempDir.deleteRecursively()
        }
    }

    private fun newServer(): MockWebServer = MockWebServer().also {
        it.start(loopbackAddress, 0)
        servers += it
    }
}
