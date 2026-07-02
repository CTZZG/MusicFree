package `fun`.upup.musicfree.mpvplayer

/**
 * 单例桥接：MpvPlayerModule ↔ MpvPlaybackService 通信。
 */
object MpvServiceBridge {
    /** Service 实例，由 [MpvPlaybackService.onCreate] 设置、onDestroy 清除。 */
    var service: MpvPlaybackService? = null

    /** 音频焦点允许 duck 时的策略：pause 或 lowerVolume。 */
    var remoteDuckMode: String = "pause"

    /** lowerVolume 策略下的目标音量比例。 */
    var remoteDuckVolume: Double = 0.5

    /** 通知栏是否显示停止/关闭按钮。 */
    var showStopAction: Boolean = false

    /** Live Update 歌词模式下，播放服务通知切换为胶囊友好的 ProgressStyle。 */
    @Volatile
    var useLiveUpdateLyricNotification: Boolean = false

    /**
     * JS 侧回调：收到通知栏/锁屏/耳机键命令时调用。
     * 由 [MpvPlayerModule] 在 initialize 时设置。
     */
    var onCommand: ((command: String, position: Double?) -> Unit)? = null
}
