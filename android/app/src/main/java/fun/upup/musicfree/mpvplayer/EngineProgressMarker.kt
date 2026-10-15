package `fun`.upup.musicfree.mpvplayer

/**
 * 每次装载新文件后，引擎的 time-pos 第一次自然往前走的时刻（性能基线里的“引擎开始推进”）。
 *
 * 只认相邻两次读数之间小幅前进（0 < 差值 < [MAX_STEP_SECONDS]）：装载后的跳转、续播位置是大跳，
 * 不算开始推进；同一次装载只报告一次，换了装载代次重新开始。这不代表扬声器已经出声。
 */
class EngineProgressMarker {
    private var generation = -1L
    private var lastPosition: Double? = null
    private var reported = true

    /** 发出 loadfile 时调用 */
    fun onLoad(loadGeneration: Long) {
        generation = loadGeneration
        lastPosition = null
        reported = false
    }

    /** 每次读到 time-pos 时调用；第一次自然前进时返回 true，之后都返回 false */
    fun onPosition(loadGeneration: Long, position: Double, paused: Boolean): Boolean {
        if (reported || loadGeneration != generation || position.isNaN() || position < 0) {
            return false
        }
        val previous = lastPosition
        lastPosition = position
        if (paused || previous == null) {
            return false
        }
        val step = position - previous
        if (step > 0 && step < MAX_STEP_SECONDS) {
            reported = true
            return true
        }
        return false
    }

    companion object {
        const val MAX_STEP_SECONDS = 1.0
    }
}
