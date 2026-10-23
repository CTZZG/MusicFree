package `fun`.upup.musicfree.diagnostics

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JavaCrashRecordsTest {
    private fun record(atMs: Long, message: String = "boom") = JavaCrashRecord(
        atMs = atMs,
        pid = 1234,
        thread = "main",
        appVersion = "0.12.1 (400034)",
        exception = "java.lang.IllegalStateException",
        message = message,
        stack = "java.lang.IllegalStateException: boom\n\tat A.b(A.kt:1)\n",
    )

    @Test
    fun aRecordSurvivesEncodingIncludingNewlinesAndBackslashes() {
        val original = record(1L, message = "line1\nline2 \\n literal\r\nend").copy(thread = "mqt\\v_js")
        assertEquals(original, JavaCrashRecordFormat.decode(JavaCrashRecordFormat.encode(original)))
    }

    @Test
    fun textThatIsNotACrashRecordIsRejected() {
        assertNull(JavaCrashRecordFormat.decode("hello"))
        assertNull(JavaCrashRecordFormat.decode("kind=other\nat=1\npid=1\nexception=x\n---\n"))
        // 必填项缺了也不算
        assertNull(JavaCrashRecordFormat.decode("kind=java-crash\npid=1\nexception=x\n---\n"))
    }

    @Test
    fun aThrowableKeepsItsCauseChainAndIsBounded() {
        val error = RuntimeException("x".repeat(5_000), IllegalArgumentException("root cause"))
        val captured = JavaCrashRecord.of(1L, 7, "main", "v", error)
        assertEquals("java.lang.RuntimeException", captured.exception)
        assertEquals(JavaCrashRecord.MAX_MESSAGE_CHARS, captured.message.length)
        assertTrue(captured.stack.length <= JavaCrashRecord.MAX_STACK_CHARS)

        val small = JavaCrashRecord.of(1L, 7, "main", "v", RuntimeException("top", IllegalArgumentException("root cause")))
        assertTrue(small.stack.contains("Caused by: java.lang.IllegalArgumentException: root cause"))
    }

    @Test
    fun theStoreKeepsOnlyTheNewestRecordsNewestFirst() {
        val directory = Files.createTempDirectory("crash-records").toFile()
        val store = JavaCrashRecordStore(directory, maxRecords = 3)
        (1L..5L).forEach { store.write(record(it)) }

        assertEquals(listOf(5L, 4L, 3L), store.readAll().map { it.atMs })
        assertEquals(3, directory.listFiles()!!.size)
    }

    @Test
    fun corruptOrUnfinishedFilesAreSkippedAndClearRemovesEverything() {
        val directory = Files.createTempDirectory("crash-records").toFile()
        val store = JavaCrashRecordStore(directory)
        store.write(record(10L))
        File(directory, "crash-11-1.txt").writeText("half a record")
        File(directory, "crash-12-1.txt.tmp").writeText(JavaCrashRecordFormat.encode(record(12L)))

        assertEquals(listOf(10L), store.readAll().map { it.atMs })

        store.clear()
        assertTrue(store.readAll().isEmpty())
        assertTrue(directory.listFiles()!!.isEmpty())
    }
}
