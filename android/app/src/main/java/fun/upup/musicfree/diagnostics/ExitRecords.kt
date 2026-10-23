package `fun`.upup.musicfree.diagnostics

import android.app.ApplicationExitInfo

/**
 * 系统记下的一次进程退出（ApplicationExitInfo）。正常退出也留着：后台播放时被系统或厂商省电策略
 * 杀掉，看的就是退出原因和当时的进程重要性。
 */
internal data class ExitRecord(
    val atMs: Long,
    val pid: Int,
    val reason: Int,
    val status: Int,
    val importance: Int,
    val pssKb: Long,
    val rssKb: Long,
    val description: String?,
    val nativeCrash: NativeCrashSummary? = null,
    val anrMainThread: String? = null,
    val javaCrashRecorded: Boolean = false,
) {
    val reasonName: String get() = ExitReasons.name(reason)
    val abnormal: Boolean get() = ExitReasons.isAbnormal(reason)
}

internal object ExitReasons {
    fun name(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_EXIT_SELF -> "exit-self"
        ApplicationExitInfo.REASON_SIGNALED -> "signaled"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
        ApplicationExitInfo.REASON_CRASH -> "crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash-native"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization-failure"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission-change"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive-resource-usage"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
        ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency-died"
        ApplicationExitInfo.REASON_OTHER -> "other"
        ApplicationExitInfo.REASON_FREEZER -> "freezer"
        ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package-state-change"
        ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package-updated"
        else -> "unknown($reason)"
    }

    /** 应用自己出了问题（崩溃、无响应、初始化失败）或因资源被系统强杀。 */
    fun isAbnormal(reason: Int): Boolean = when (reason) {
        ApplicationExitInfo.REASON_CRASH,
        ApplicationExitInfo.REASON_CRASH_NATIVE,
        ApplicationExitInfo.REASON_ANR,
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE,
        ApplicationExitInfo.REASON_LOW_MEMORY,
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> true
        else -> false
    }

    /**
     * 本机清过记录之后的退出，最新的在前。Java 崩溃已经单独记了调用栈的，同一进程的 crash 退出只标记、不重复给出描述。
     */
    fun visible(
        exits: List<ExitRecord>,
        javaCrashPids: Set<Int>,
        clearedBeforeMs: Long,
        max: Int,
    ): List<ExitRecord> = exits
        .filter { it.atMs > clearedBeforeMs }
        .sortedByDescending { it.atMs }
        .take(max)
        .map { exit ->
            if (exit.reason == ApplicationExitInfo.REASON_CRASH && exit.pid in javaCrashPids) {
                exit.copy(description = null, javaCrashRecorded = true)
            } else {
                exit
            }
        }
}

internal object AnrTrace {
    /**
     * ANR 时系统抓的线程栈是文本：每个线程一段，以 `"线程名" prio=` 开头，段与段之间空一行。
     * 只取主线程这一段，其余线程太长且通常无关。
     */
    fun mainThread(text: String, maxChars: Int = 8_000): String? {
        val lines = text.lineSequence().iterator()
        val block = StringBuilder()
        var inMain = false
        while (lines.hasNext()) {
            val line = lines.next()
            if (!inMain) {
                if (line.startsWith("\"main\"")) {
                    inMain = true
                    block.append(line).append('\n')
                }
                continue
            }
            if (line.isBlank()) break
            block.append(line).append('\n')
            if (block.length >= maxChars) break
        }
        return block.takeIf { it.isNotEmpty() }?.toString()?.trimEnd()?.take(maxChars)
    }
}
