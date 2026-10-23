package `fun`.upup.musicfree.diagnostics

import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * 一次未捕获的 Java/Kotlin 崩溃：进程退出前写到本机，下次启动后随“复制播放诊断”带出。
 * 只存类名、消息和调用栈，不上传。
 */
internal data class JavaCrashRecord(
    val atMs: Long,
    val pid: Int,
    val thread: String,
    val appVersion: String,
    val exception: String,
    val message: String,
    val stack: String,
) {
    companion object {
        const val MAX_MESSAGE_CHARS = 1_000
        const val MAX_STACK_CHARS = 12_000

        fun of(
            atMs: Long,
            pid: Int,
            thread: String,
            appVersion: String,
            error: Throwable,
        ): JavaCrashRecord {
            val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
            return JavaCrashRecord(
                atMs = atMs,
                pid = pid,
                thread = thread,
                appVersion = appVersion,
                exception = error.javaClass.name,
                message = (error.message ?: "").take(MAX_MESSAGE_CHARS),
                stack = stack.take(MAX_STACK_CHARS),
            )
        }
    }
}

/**
 * 崩溃记录的文本格式：前面是 key=value 头（值里的换行、反斜杠转义），一行 `---` 之后是调用栈原文。
 * 不用 JSON：要在进程将死时尽量少依赖、少分配，也要能在纯 JVM 测试里读写。
 */
internal object JavaCrashRecordFormat {
    private const val SEPARATOR = "---"

    fun encode(record: JavaCrashRecord): String = buildString {
        append("kind=java-crash\n")
        append("at=").append(record.atMs).append('\n')
        append("pid=").append(record.pid).append('\n')
        append("thread=").append(escape(record.thread)).append('\n')
        append("version=").append(escape(record.appVersion)).append('\n')
        append("exception=").append(escape(record.exception)).append('\n')
        append("message=").append(escape(record.message)).append('\n')
        append(SEPARATOR).append('\n')
        append(record.stack)
    }

    fun decode(text: String): JavaCrashRecord? {
        val split = text.indexOf("\n$SEPARATOR\n")
        if (split < 0) return null
        val header = text.substring(0, split).lines().mapNotNull { line ->
            val eq = line.indexOf('=')
            if (eq <= 0) null else line.substring(0, eq) to unescape(line.substring(eq + 1))
        }.toMap()
        if (header["kind"] != "java-crash") return null
        return JavaCrashRecord(
            atMs = header["at"]?.toLongOrNull() ?: return null,
            pid = header["pid"]?.toIntOrNull() ?: return null,
            thread = header["thread"] ?: "",
            appVersion = header["version"] ?: "",
            exception = header["exception"] ?: return null,
            message = header["message"] ?: "",
            stack = text.substring(split + SEPARATOR.length + 2),
        )
    }

    private fun escape(value: String) =
        value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")

    private fun unescape(value: String): String {
        val out = StringBuilder(value.length)
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c == '\\' && i + 1 < value.length) {
                when (value[i + 1]) {
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    else -> out.append(value[i + 1])
                }
                i += 2
            } else {
                out.append(c)
                i++
            }
        }
        return out.toString()
    }
}

/**
 * 每次崩溃一个文件，先写临时文件再改名，进程在写的中途被杀也不会留下半个记录。
 * 只留最新的 [maxRecords] 条。
 */
internal class JavaCrashRecordStore(
    private val directory: File,
    private val maxRecords: Int = 10,
) {
    fun write(record: JavaCrashRecord) {
        directory.mkdirs()
        val name = "crash-${record.atMs}-${record.pid}.txt"
        val temp = File(directory, "$name.tmp")
        temp.writeText(JavaCrashRecordFormat.encode(record))
        if (!temp.renameTo(File(directory, name))) {
            temp.delete()
            return
        }
        prune()
    }

    /** 最新的在前；读不出的文件跳过。 */
    fun readAll(): List<JavaCrashRecord> =
        recordFiles().mapNotNull { file ->
            try {
                JavaCrashRecordFormat.decode(file.readText())
            } catch (_: Exception) {
                null
            }
        }.sortedByDescending { it.atMs }

    fun clear() {
        directory.listFiles()?.forEach { it.delete() }
    }

    private fun prune() {
        val files = recordFiles().sortedByDescending { it.name.removePrefix("crash-").substringBefore('-').toLongOrNull() ?: 0L }
        files.drop(maxRecords).forEach { it.delete() }
    }

    private fun recordFiles(): List<File> =
        directory.listFiles { file -> file.name.startsWith("crash-") && file.name.endsWith(".txt") }
            ?.toList()
            ?: emptyList()
}
