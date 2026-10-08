package `fun`.upup.musicfree.mpvplayer

data class MpvQueueTrack(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val artwork: String?,
)

/**
 * 当前这首歌封面的加载结果。只记 host，不记完整地址（里面常带签名票据）。
 */
data class ArtworkLoadStatus(
    /** none（应用没给封面地址）、loading、loaded、retrying、failed */
    val state: String,
    val host: String?,
    val attempt: Int,
    val reason: String?,
    val updatedAt: Long,
)

/**
 * 单例桥接：MpvPlayerModule ↔ MpvPlaybackService 通信。
 */
object MpvServiceBridge {
    /** Service 实例，由 [MpvPlaybackService.onCreate] 设置、onDestroy 清除。 */
    @Volatile
    var service: MpvPlaybackService? = null

    /** 音频焦点允许 duck 时的策略：pause 或 lowerVolume。 */
    var remoteDuckMode: String = "pause"

    /** lowerVolume 策略下的目标音量比例。 */
    var remoteDuckVolume: Double = 0.5

    /** 通知栏是否显示停止/关闭按钮。 */
    var showStopAction: Boolean = false

    /** Android Auto / Android Automotive 当前是否连接。 */
    @Volatile
    var isAndroidAutoConnected: Boolean = false

    /**
     * Live Update 歌词：开着时播放服务的通知用胶囊友好的 ProgressStyle。
     * 开关和当前这句分开记，见 [LiveUpdateLyricState]。
     */
    internal val liveUpdateLyric = LiveUpdateLyricState()

    /**
     * 给「复制播放诊断信息」用：封面拿不到时，通知、锁屏和 Live Update 都只会
     * 退回默认图标，没有 adb 时只能从这里看出原因。
     */
    @Volatile
    var artworkStatus: ArtworkLoadStatus? = null

    @Volatile
    var currentQueueIndex: Int = -1

    private val queueLock = Any()
    private var queueSnapshot: List<MpvQueueTrack> = emptyList()

    fun updateQueueSnapshot(
        tracks: List<MpvQueueTrack>,
        currentIndex: Int,
    ) {
        synchronized(queueLock) {
            queueSnapshot = tracks
            currentQueueIndex = currentIndex
        }
        service?.onQueueSnapshotChanged()
        MpvMediaBrowserService.getInstance()?.onQueueUpdated()
    }

    fun clearPlaybackSession() {
        synchronized(queueLock) {
            queueSnapshot = emptyList()
            currentQueueIndex = -1
        }
        // 开关是用户设置，不随播放会话重建清掉；上一首的歌词作废
        liveUpdateLyric.clearLyric()
        service?.onQueueSnapshotChanged()
        MpvMediaBrowserService.getInstance()?.onQueueUpdated()
    }

    fun getQueueSnapshot(): List<MpvQueueTrack> =
        synchronized(queueLock) { queueSnapshot.toList() }

    /**
     * JS 侧回调：收到通知栏/锁屏/耳机键命令时调用。
     * 由 [MpvPlayerModule] 在 initialize 时设置。
     */
    @Volatile
    var onCommand: ((command: String, position: Double?, mediaId: String?) -> Unit)? = null
}
