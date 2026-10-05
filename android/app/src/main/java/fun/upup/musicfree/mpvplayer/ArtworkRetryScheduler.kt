package `fun`.upup.musicfree.mpvplayer

/**
 * 封面重试的计时。
 *
 * 停止播放（关闭通知、出错）时把还没到点的重试收起来，下次开始播放再接着试：
 * 停止后不在后台继续联网，迟到的结果也不会去碰已经关掉的通知。是否发通知由
 * 服务自己按播放状态把关，这里只管什么时候再试。
 *
 * 所有方法都在主线程调用。
 */
internal class ArtworkRetryScheduler(
    private val post: (Runnable, Long) -> Unit,
    private val cancel: (Runnable) -> Unit,
    private val retry: () -> Unit,
) {
    private var scheduled = false
    private var deferred = false

    private val runnable = Runnable {
        scheduled = false
        retry()
    }

    /** 一次失败后安排下一次；已经停止播放时先记下，等 [onPlaybackStarted]。 */
    fun schedule(delayMs: Long, playbackStopped: Boolean) {
        cancel(runnable)
        scheduled = false
        if (playbackStopped) {
            deferred = true
            return
        }
        deferred = false
        scheduled = true
        post(runnable, delayMs)
    }

    fun onPlaybackStopped() {
        if (scheduled) {
            cancel(runnable)
            scheduled = false
            deferred = true
        }
    }

    fun onPlaybackStarted() {
        if (deferred) {
            deferred = false
            scheduled = true
            post(runnable, 0L)
        }
    }

    /** 换曲：上一首的重试作废。 */
    fun reset() {
        cancel(runnable)
        scheduled = false
        deferred = false
    }
}
