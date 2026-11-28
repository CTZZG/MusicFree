package `fun`.upup.musicfree.download

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.nio.file.Files
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
    fun pauseMidStreamPreservesPartialFileAndResumesWithRange206() {
        val payload = ByteArray(256 * 1024) { idx -> (idx % 251).toByte() }
        val tempDir = Files.createTempDirectory("mf-dl-exec-").toFile()
        try {
            val destFile = File(tempDir, "track.part")
            val dynamicServer = newServer()
            dynamicServer.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
                    val range = request.getHeader("Range")
                    if (range == null) {
                        return MockResponse()
                            .setResponseCode(200)
                            .setHeader("Content-Length", payload.size.toString())
                            .setBody(Buffer().write(payload))
                            .throttleBody(32 * 1024L, 80, TimeUnit.MILLISECONDS)
                    }
                    val start = range.removePrefix("bytes=").removeSuffix("-").toInt()
                    return MockResponse()
                        .setResponseCode(206)
                        .setHeader("Content-Range", "bytes $start-${payload.size - 1}/${payload.size}")
                        .setHeader("Content-Length", (payload.size - start).toString())
                        .setBody(Buffer().write(payload, start, payload.size - start))
                }
            }

            val executor = DownloadExecutor(OkHttpClient())
            val task = DownloadTask(
                taskId = "t-1",
                url = dynamicServer.url("/song.mp3").toString(),
                destinationPath = destFile.absolutePath,
                headers = emptyMap(),
                title = "song",
                description = "artist",
                coverUrl = null,
                extraJson = null,
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
            val partialLen = destFile.length()
            assertTrue(partialLen > 0L && partialLen < payload.size)

            val control2 = DownloadExecutor.ExecutionControl()
            val result2 = executor.execute(task, control2) { _, _ -> }

            assertEquals(DownloadTaskStatus.COMPLETED, result2.finalStatus)
            assertEquals(payload.size.toLong(), destFile.length())
            assertArrayEquals(payload, destFile.readBytes())
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
                headers = emptyMap(),
                title = "song",
                description = "artist",
                coverUrl = null,
                extraJson = null,
            )
            val control = DownloadExecutor.ExecutionControl().apply { pause() }
            val result = executor.execute(task, control) { _, _ -> }

            assertEquals(DownloadTaskStatus.PAUSED, result.finalStatus)
            assertArrayEquals(existing, destFile.readBytes())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    private fun newServer(): MockWebServer = MockWebServer().also {
        it.start(loopbackAddress, 0)
        servers += it
    }
}
