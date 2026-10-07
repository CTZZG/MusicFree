package `fun`.upup.musicfree.mpvplayer

/**
 * 新文件还在加载时收到的跳转。
 *
 * loadfile replace 之后、FILE_LOADED 之前，mpv 还没开始播新文件，这时执行 seek
 * 不是被拒绝就是落在正要换掉的旧文件上，跳转就丢了：换音质、播放地址过期重新取、
 * 冷启动恢复进度时，歌都会从头播。这期间的跳转先记在这里，等这一代文件加载好再执行；
 * 开始加载下一个文件时，丢掉没用上的。
 *
 * 只在主线程调用。
 */
internal class PendingSeek {
    private var generation = NONE
    private var seconds: Double? = null

    /** 开始加载新的一代文件：上一代没用上的跳转作废。 */
    fun reset() {
        generation = NONE
        seconds = null
    }

    /** 第 [loadingGeneration] 代文件还在加载时记下跳转；后来的覆盖先来的。 */
    fun defer(loadingGeneration: Long, seconds: Double) {
        generation = loadingGeneration
        this.seconds = seconds.coerceAtLeast(0.0)
    }

    /** 第 [loadedGeneration] 代文件加载好时取出要执行的跳转；不是这一代记下的返回 null。 */
    fun take(loadedGeneration: Long): Double? {
        val value = seconds?.takeIf { generation == loadedGeneration }
        reset()
        return value
    }

    private companion object {
        const val NONE = -1L
    }
}
