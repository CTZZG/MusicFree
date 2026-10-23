package `fun`.upup.musicfree.diagnostics

import android.app.ApplicationExitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExitRecordsTest {
    private fun exit(atMs: Long, reason: Int, pid: Int = 1, description: String? = "d") = ExitRecord(
        atMs = atMs,
        pid = pid,
        reason = reason,
        status = 0,
        importance = 125,
        pssKb = 0,
        rssKb = 0,
        description = description,
    )

    @Test
    fun reasonsHaveStableNamesAndOnlyAppProblemsAreAbnormal() {
        assertEquals("crash-native", exit(1, ApplicationExitInfo.REASON_CRASH_NATIVE).reasonName)
        assertEquals("anr", exit(1, ApplicationExitInfo.REASON_ANR).reasonName)
        assertEquals("unknown(999)", exit(1, 999).reasonName)

        assertTrue(exit(1, ApplicationExitInfo.REASON_CRASH).abnormal)
        assertTrue(exit(1, ApplicationExitInfo.REASON_LOW_MEMORY).abnormal)
        // 用户划掉、自己退出、厂商或系统发信号结束都不算应用出错，但照样列出来
        assertFalse(exit(1, ApplicationExitInfo.REASON_USER_REQUESTED).abnormal)
        assertFalse(exit(1, ApplicationExitInfo.REASON_SIGNALED).abnormal)
    }

    @Test
    fun onlyExitsAfterTheLastClearAreShownNewestFirst() {
        val exits = listOf(
            exit(10, ApplicationExitInfo.REASON_SIGNALED),
            exit(30, ApplicationExitInfo.REASON_ANR),
            exit(20, ApplicationExitInfo.REASON_LOW_MEMORY),
            exit(5, ApplicationExitInfo.REASON_CRASH),
        )

        val visible = ExitReasons.visible(exits, emptySet(), clearedBeforeMs = 10, max = 10)
        assertEquals(listOf(30L, 20L), visible.map { it.atMs })
        assertEquals(listOf(30L), ExitReasons.visible(exits, emptySet(), 0, max = 1).map { it.atMs })
    }

    @Test
    fun aJavaCrashAlreadyRecordedWithItsStackIsNotDescribedTwice() {
        val exits = listOf(
            exit(3, ApplicationExitInfo.REASON_CRASH, pid = 7),
            exit(2, ApplicationExitInfo.REASON_CRASH, pid = 8),
            exit(1, ApplicationExitInfo.REASON_ANR, pid = 7),
        )

        val visible = ExitReasons.visible(exits, javaCrashPids = setOf(7), clearedBeforeMs = 0, max = 10)
        assertTrue(visible[0].javaCrashRecorded)
        assertNull(visible[0].description)
        assertFalse(visible[1].javaCrashRecorded)
        assertEquals("d", visible[1].description)
        // 同一个 pid 的其他退出原因不受影响
        assertFalse(visible[2].javaCrashRecorded)
    }

    @Test
    fun onlyTheMainThreadOfAnAnrTraceIsKept() {
        val trace = """
            ----- pid 4000 at 2026-10-22 10:00:00 -----
            Cmd line: fun.upup.musicfree

            "Signal Catcher" daemon prio=10 tid=2 Runnable
              at nothing

            "main" prio=5 tid=1 Blocked
              | group="main" sCount=1
              at fun.upup.musicfree.Foo.bar(Foo.kt:12)
              - waiting to lock <0x01> held by thread 23

            "mqt_v_js" prio=5 tid=23 Native
              at com.facebook.Baz.qux(Baz.kt:3)
        """.trimIndent()

        assertEquals(
            """
            "main" prio=5 tid=1 Blocked
              | group="main" sCount=1
              at fun.upup.musicfree.Foo.bar(Foo.kt:12)
              - waiting to lock <0x01> held by thread 23
            """.trimIndent(),
            AnrTrace.mainThread(trace),
        )
        assertNull(AnrTrace.mainThread("\"worker\" prio=5\n  at x"))
        assertEquals(40, AnrTrace.mainThread(trace, maxChars = 40)!!.length)
    }
}
