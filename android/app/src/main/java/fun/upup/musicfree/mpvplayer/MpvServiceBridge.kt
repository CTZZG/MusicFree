package `fun`.upup.musicfree.mpvplayer

/**
 * 单例桥接：MpvPlayerModule ↔ MpvPlaybackService 通信。
 */
object MpvServiceBridge {
    /** Service 实例，由 [MpvPlaybackService.onCreate] 设置、onDestroy 清除。 */
    var service: MpvPlaybackService? = null

    /**
     * JS 侧回调：收到通知栏/锁屏/耳机键命令时调用。
     * 由 [MpvPlayerModule] 在 initialize 时设置。
     */
    var onCommand: ((command: String, position: Double?) -> Unit)? = null
}
