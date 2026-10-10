package `fun`.upup.musicfree.mpvplayer

/**
 * 现在许不许自动出声。
 *
 * 通知栏、锁屏、耳机、蓝牙上的暂停，拔耳机，其他应用永久拿走音频焦点，都是用户
 * （或系统替用户）明确要停：之后装载完成、恢复后排着的取消暂停重试（见
 * [PendingUnpause]）、JS 的自动播放补偿都不能把声音放出来，要一直停到用户明确
 * 要播。来电、短视频临时占用音频焦点是系统打断：打断期间同样不许自动出声，免得
 * 把焦点抢回来；系统还回焦点只解除这一项，打断期间用户又暂停过的照样停着。
 *
 * 这些命令要转到 JS 才处理，JS 在收到之前可能已经发出了自动播放，所以拦截放在
 * 原生：先在这里记下，再通知 JS。
 *
 * 只在主线程调用。
 */
internal class PlaybackHold {
    private var pausedByUser = false
    private var interrupted = false

    /** 用户在外部暂停了（含拔耳机、其他应用永久拿走音频焦点）。 */
    fun pauseByUser() {
        pausedByUser = true
    }

    /** 系统临时收回音频焦点。 */
    fun interrupt() {
        interrupted = true
    }

    /**
     * 系统还回音频焦点。返回之前是不是处在临时打断中：是的话通知 JS，由它按用户
     * 意图决定要不要接着放。
     */
    fun endInterruption(): Boolean {
        val wasInterrupted = interrupted
        interrupted = false
        return wasInterrupted
    }

    /** 用户明确要播：通知栏、锁屏上的播放，应用里的播放、点歌、切歌。 */
    fun claim() {
        pausedByUser = false
        interrupted = false
    }

    /** 装载完成、恢复后的自动取消暂停现在要不要拦下。 */
    val blocksAutoPlay: Boolean
        get() = pausedByUser || interrupted

    override fun toString(): String =
        "PlaybackHold(pausedByUser=$pausedByUser, interrupted=$interrupted)"
}
