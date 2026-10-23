package `fun`.upup.musicfree.diagnostics

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Process
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import `fun`.upup.musicfree.BuildConfig
import java.io.File
import java.io.InputStream
import kotlin.system.exitProcess

/**
 * 本机的崩溃和退出记录，不联网、不上传：用户在“复制播放诊断”里看到、自己决定要不要发出去。
 *
 * - 未捕获的 Java/Kotlin 异常：进程退出前写一条记录（[JavaCrashRecordStore]），再交给原来的处理器。
 * - 原生崩溃、ANR、被系统杀掉：读系统保存的 ApplicationExitInfo，原生崩溃只取信号和崩溃线程的调用栈，
 *   ANR 只取主线程栈。读取只在用户要诊断时进行，不拖慢启动。
 */
internal object CrashDiagnostics {
    private const val MAX_JAVA_CRASHES = 5
    private const val MAX_EXITS = 10
    private const val MAX_TOMBSTONE_BYTES = 6 * 1024 * 1024
    private const val MAX_ANR_TRACE_BYTES = 2 * 1024 * 1024

    data class Snapshot(
        val javaCrashes: List<JavaCrashRecord>,
        val exits: List<ExitRecord>,
        val clearedBeforeMs: Long,
    )

    fun install(context: Context) {
        val store = javaCrashStore(context)
        val version = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                store.write(
                    JavaCrashRecord.of(System.currentTimeMillis(), Process.myPid(), thread.name, version, error),
                )
            } catch (_: Throwable) {
                // 记录失败也不能挡住原来的崩溃处理
            } finally {
                if (previous != null) {
                    previous.uncaughtException(thread, error)
                } else {
                    Process.killProcess(Process.myPid())
                    exitProcess(10)
                }
            }
        }
    }

    fun collect(context: Context): Snapshot {
        val clearedBefore = clearedBeforeMs(context)
        val javaCrashes = javaCrashStore(context).readAll().filter { it.atMs > clearedBefore }
        val activityManager = context.getSystemService(ActivityManager::class.java)
        // 系统按时间倒序给出；先筛再读调用栈，最多读 MAX_EXITS 份
        val exits = activityManager
            ?.getHistoricalProcessExitReasons(context.packageName, 0, MAX_EXITS)
            .orEmpty()
            .filter { it.timestamp > clearedBefore }
            .map(::toExitRecord)
        return Snapshot(
            javaCrashes = javaCrashes.take(MAX_JAVA_CRASHES),
            exits = ExitReasons.visible(exits, javaCrashes.map { it.pid }.toSet(), clearedBefore, MAX_EXITS),
            clearedBeforeMs = clearedBefore,
        )
    }

    /** 清掉本机的崩溃记录；系统的退出历史删不掉，记下清除时刻，以后只显示之后的。 */
    fun clear(context: Context) {
        javaCrashStore(context).clear()
        clearedMarker(context).apply {
            parentFile?.mkdirs()
            writeText(System.currentTimeMillis().toString())
        }
    }

    fun toWritable(snapshot: Snapshot): WritableMap = Arguments.createMap().apply {
        putDouble("clearedBefore", snapshot.clearedBeforeMs.toDouble())
        putArray("javaCrashes", Arguments.createArray().apply {
            snapshot.javaCrashes.forEach { crash ->
                pushMap(Arguments.createMap().apply {
                    putDouble("at", crash.atMs.toDouble())
                    putString("thread", crash.thread)
                    putString("appVersion", crash.appVersion)
                    putString("exception", crash.exception)
                    putString("message", crash.message)
                    putString("stack", crash.stack)
                })
            }
        })
        putArray("exits", Arguments.createArray().apply {
            snapshot.exits.forEach { exit ->
                pushMap(Arguments.createMap().apply {
                    putDouble("at", exit.atMs.toDouble())
                    putString("reason", exit.reasonName)
                    putBoolean("abnormal", exit.abnormal)
                    putInt("status", exit.status)
                    putInt("importance", exit.importance)
                    putDouble("pssKb", exit.pssKb.toDouble())
                    putDouble("rssKb", exit.rssKb.toDouble())
                    exit.description?.let { putString("description", it) }
                    if (exit.javaCrashRecorded) putBoolean("javaCrashRecorded", true)
                    exit.anrMainThread?.let { putString("anrMainThread", it) }
                    exit.nativeCrash?.let { native ->
                        putMap("nativeCrash", Arguments.createMap().apply {
                            native.signal?.let { putString("signal", it) }
                            native.signalCode?.let { putString("signalCode", it) }
                            native.faultAddress?.let { putString("faultAddress", "0x" + java.lang.Long.toHexString(it)) }
                            native.abortMessage?.let { putString("abortMessage", it) }
                            native.threadName?.let { putString("thread", it) }
                            putArray("causes", Arguments.fromList(native.causes))
                            putArray("frames", Arguments.fromList(native.frames))
                        })
                    }
                })
            }
        })
    }

    private fun toExitRecord(info: ApplicationExitInfo): ExitRecord {
        var nativeCrash: NativeCrashSummary? = null
        var anrMainThread: String? = null
        when (info.reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE ->
                nativeCrash = readTrace(info, MAX_TOMBSTONE_BYTES)?.let { TombstoneSummary.summarize(it) }
            ApplicationExitInfo.REASON_ANR ->
                anrMainThread = readTrace(info, MAX_ANR_TRACE_BYTES)
                    ?.let { AnrTrace.mainThread(it.toString(Charsets.UTF_8)) }
        }
        return ExitRecord(
            atMs = info.timestamp,
            pid = info.pid,
            reason = info.reason,
            status = info.status,
            importance = info.importance,
            pssKb = info.pss,
            rssKb = info.rss,
            description = info.description?.take(500),
            nativeCrash = nativeCrash,
            anrMainThread = anrMainThread,
        )
    }

    /** 超过上限的不读：截断的 protobuf 本来也解析不出来。 */
    private fun readTrace(info: ApplicationExitInfo, limit: Int): ByteArray? = try {
        info.traceInputStream?.use { readAtMost(it, limit) }
    } catch (_: Exception) {
        null
    }

    private fun readAtMost(input: InputStream, limit: Int): ByteArray? {
        val bytes = input.readNBytes(limit + 1)
        return bytes.takeIf { it.size <= limit }
    }

    private fun javaCrashStore(context: Context) =
        JavaCrashRecordStore(File(diagnosticsDirectory(context), "java-crashes"), maxRecords = 10)

    private fun clearedMarker(context: Context) = File(diagnosticsDirectory(context), "cleared-before")

    private fun clearedBeforeMs(context: Context): Long = try {
        clearedMarker(context).takeIf { it.exists() }?.readText()?.trim()?.toLongOrNull() ?: 0L
    } catch (_: Exception) {
        0L
    }

    private fun diagnosticsDirectory(context: Context) = File(context.applicationContext.filesDir, "crash-diagnostics")
}
