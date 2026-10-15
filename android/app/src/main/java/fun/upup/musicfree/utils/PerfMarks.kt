package `fun`.upup.musicfree.utils

import android.util.Log

/**
 * 性能基线用的时间点，写到 logcat（标签 MusicFreePerf），每行 “名字 at=<墙钟毫秒> 其他”。
 * 端到端测试（e2e/perf.sh）读这些行算耗时；应用自己不读，也不改变任何行为。
 */
object PerfMarks {
    const val TAG = "MusicFreePerf"

    fun mark(name: String, detail: String = "", atMs: Long = System.currentTimeMillis()) {
        Log.i(TAG, if (detail.isEmpty()) "$name at=$atMs" else "$name at=$atMs $detail")
    }
}
