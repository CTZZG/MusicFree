package `fun`.upup.musicfree.mpvplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import `fun`.upup.musicfree.R
import `fun`.upup.musicfree.network.PublicHttpsNetworkPolicy
import java.io.ByteArrayOutputStream
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Foreground playback service for the mpv backend.
 *
 * It mirrors the Nitro-facing system surface: MediaSession transport controls,
 * lock-screen metadata/artwork, progress notification, audio focus and noisy
 * route handling. Actual queue decisions stay in JS.
 */
class MpvPlaybackService : Service() {

    companion object {
        private const val TAG = "MpvPlaybackService"
        private const val CHANNEL_ID = "musicfree_mpv_playback"
        private const val NOTIFICATION_ID = 3001
        private const val NOTIFICATION_PROGRESS_UPDATE_MS = 1000L
        private const val LIVE_UPDATE_PROGRESS_UPDATE_MS = 1000L
        private const val API_LIVE_UPDATE = 36
        private const val CHIP_TEXT_MAX_CODE_POINTS = 12
        private const val TRUNCATION_MARK = "…"
        private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
        private const val MAX_ARTWORK_DECODE_SIZE = 512
        private const val MAX_ARTWORK_DOWNLOAD_BYTES = 8 * 1024 * 1024
        private const val WAKE_LOCK_TAG = "MusicFree:MpvPlayback"

        /**
         * 曲目切换要走「原生 END_FILE → JS 决策 → 解析音源 → 重新 loadfile」一整圈，
         * 这段时间音频输出是空的，AudioFlinger 的 AudioMix wake lock 会释放，
         * CPU 可能直接休眠，切歌就永远停在这里。所以非播放态不立刻放锁，
         * 而是留一段宽限期覆盖整个切歌窗口（Nitro 走的 ExoPlayer 是用
         * setWakeMode(WAKE_MODE_NETWORK) 达到同样效果）。
         */
        private const val WAKE_LOCK_GRACE_MS = 45_000L

        private const val ACTION_PLAY_PAUSE = "mpv_play_pause"
        private const val ACTION_NEXT = "mpv_next"
        private const val ACTION_PREV = "mpv_prev"
        private const val ACTION_STOP = "mpv_stop"
        const val ACTION_START_FOREGROUND = "mpv_start_foreground"

        private fun formatTime(ms: Long): String {
            val totalSec = max(0L, ms / 1000)
            return "${totalSec / 60}:${(totalSec % 60).toString().padStart(2, '0')}"
        }

        private fun pendingIntentFlag(): Int =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE
            } else {
                0
            }
    }

    private lateinit var mediaSession: MediaSessionCompat
    private val artworkHttpClient = PublicHttpsNetworkPolicy.clientBuilder()
        .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val artworkExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var notificationManager: NotificationManager? = null
    private var audioManager: AudioManager? = null
    private var audioFocusListener: AudioManager.OnAudioFocusChangeListener? = null
    private var isForeground = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var wakeLockReleaseScheduled = false
    private var noisyReceiverRegistered = false
    private var pausedForTransientFocusLoss = false
    private var duckedForFocusLoss = false
    private var lastNotificationUpdateMs = 0L
    private var cachedPositionUpdatedAtMs = 0L
    private var liveUpdateProgressTickerScheduled = false

    private var cachedTitle = ""
    private var cachedArtist = ""
    private var cachedAlbum = ""
    private var cachedArtwork: String? = null
    private var cachedArtworkBitmap: Bitmap? = null
    private var cachedMediaNotificationLyric = ""
    private var cachedLiveUpdateLyric = ""
    private var cachedDuration = 0L
    private var cachedPosition = 0L
    private var cachedBufferedPosition = 0L
    private var cachedState = PlaybackStateCompat.STATE_NONE

    private val allActions: Long =
        PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID

    private val liveUpdateProgressTicker = object : Runnable {
        override fun run() {
            liveUpdateProgressTickerScheduled = false
            if (!shouldTickLiveUpdateProgress()) return
            updatePlaybackState()
            updateNotification()
            scheduleLiveUpdateProgressTicker()
        }
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (
                intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY &&
                cachedState == PlaybackStateCompat.STATE_PLAYING
            ) {
                MpvServiceBridge.onCommand?.invoke("pause", null, null)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        MpvServiceBridge.service = this
        createNotificationChannel()
        createMediaSession()
        registerNoisyReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            // 进程崩溃后系统会按 START_STICKY 用 null intent 重建本服务，但 RN
            // module 和 MpvServiceBridge 都随旧进程一起没了。此时通知还挂着、
            // 按钮却全是 no-op（onCommand 为 null），用户看到的就是「上一首/
            // 下一首/暂停全都点不动」。恢复不了就不要留下幽灵通知。
            if (MpvServiceBridge.onCommand == null) {
                Log.w(
                    TAG,
                    "service recreated without a live player bridge; " +
                        "clearing stale notification",
                )
                stopForegroundSafely()
                stopSelf()
            }
            return START_NOT_STICKY
        }
        when (intent.action) {
            ACTION_START_FOREGROUND -> startForegroundSafely()
            ACTION_PLAY_PAUSE -> {
                if (
                    cachedState == PlaybackStateCompat.STATE_PLAYING ||
                    cachedState == PlaybackStateCompat.STATE_BUFFERING
                ) {
                    MpvServiceBridge.onCommand?.invoke("pause", null, null)
                } else {
                    MpvServiceBridge.onCommand?.invoke("play", null, null)
                }
            }
            ACTION_NEXT -> MpvServiceBridge.onCommand?.invoke("next", null, null)
            ACTION_PREV -> MpvServiceBridge.onCommand?.invoke("previous", null, null)
            ACTION_STOP -> MpvServiceBridge.onCommand?.invoke("stop", null, null)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    fun mediaSessionTokenOrNull(): MediaSessionCompat.Token? =
        if (::mediaSession.isInitialized) mediaSession.sessionToken else null

    fun onQueueSnapshotChanged() {
        val tracks = MpvServiceBridge.getQueueSnapshot()
        val currentIndex = MpvServiceBridge.currentQueueIndex
        if (Looper.myLooper() == Looper.getMainLooper()) {
            updateMediaSessionQueue(tracks, currentIndex)
        } else {
            mainHandler.post { updateMediaSessionQueue(tracks, currentIndex) }
        }
    }

    override fun onDestroy() {
        releaseWakeLock()
        mainHandler.removeCallbacksAndMessages(null)
        MpvServiceBridge.service = null
        cancelLiveUpdateProgressTicker()
        unregisterNoisyReceiver()
        stopForegroundSafely()
        mediaSession.release()
        artworkExecutor.shutdownNow()
        abandonAudioFocus()
        super.onDestroy()
    }

    fun onMetadataChanged(
        title: String,
        artist: String,
        album: String,
        artwork: String?,
        durationSecs: Double,
    ) {
        val isNewTrack =
            title != cachedTitle ||
                artist != cachedArtist ||
                album != cachedAlbum ||
                artwork != cachedArtwork

        cachedTitle = title
        cachedArtist = artist
        cachedAlbum = album
        cachedArtwork = artwork
        cachedDuration = secondsToMillis(durationSecs)

        if (isNewTrack) {
            cachedPosition = 0L
            cachedBufferedPosition = 0L
            cachedPositionUpdatedAtMs = System.currentTimeMillis()
            cachedArtworkBitmap = null
            cachedMediaNotificationLyric = ""
            cachedLiveUpdateLyric = ""
        }

        updateMediaSessionMetadata()
        if (!artwork.isNullOrBlank() && isNewTrack) {
            loadArtworkAsync(artwork)
        }
        updateAll()
    }

    fun onPlaybackStateChanged(state: String) {
        when (state) {
            "playing" -> {
                acquireWakeLock()
                requestAudioFocus()
                startForegroundSafely()
                cachedState = PlaybackStateCompat.STATE_PLAYING
                cachedPositionUpdatedAtMs = System.currentTimeMillis()
                updateAll()
            }
            "buffering" -> {
                acquireWakeLock()
                requestAudioFocus()
                startForegroundSafely()
                cachedState = PlaybackStateCompat.STATE_BUFFERING
                cachedPositionUpdatedAtMs = System.currentTimeMillis()
                updateAll()
            }
            "paused" -> {
                // 手动切歌也会先经过一次 paused，所以这里同样走宽限期释放。
                scheduleWakeLockRelease()
                cachedPosition = currentNotificationPosition()
                cachedPositionUpdatedAtMs = System.currentTimeMillis()
                cachedState = PlaybackStateCompat.STATE_PAUSED
                updateAll()
            }
            "ended" -> {
                // 自然结束后 JS 还要决策下一首，锁必须继续持有到宽限期结束。
                acquireWakeLock()
                scheduleWakeLockRelease()
                cachedPosition = currentNotificationPosition()
                cachedPositionUpdatedAtMs = System.currentTimeMillis()
                cachedState = PlaybackStateCompat.STATE_PAUSED
                updateAll()
            }
            "error", "idle" -> {
                releaseWakeLock()
                abandonAudioFocus()
                cachedState = PlaybackStateCompat.STATE_STOPPED
                updatePlaybackState()
                stopForegroundSafely()
            }
        }
    }

    fun onProgressChanged(
        positionSecs: Double,
        durationSecs: Double,
        bufferedSecs: Double,
    ) {
        cachedPosition = secondsToMillis(positionSecs)
        cachedBufferedPosition = secondsToMillis(bufferedSecs)
        cachedPositionUpdatedAtMs = System.currentTimeMillis()
        val nextDuration = secondsToMillis(durationSecs)
        val durationChanged = nextDuration > 0 && nextDuration != cachedDuration
        if (durationChanged) {
            cachedDuration = nextDuration
            updateMediaSessionMetadata()
        }

        updatePlaybackState()

        val now = System.currentTimeMillis()
        if (
            durationChanged ||
            now - lastNotificationUpdateMs >= NOTIFICATION_PROGRESS_UPDATE_MS
        ) {
            updateNotification()
        }
    }

    fun onMediaNotificationLyricChanged(lyric: String?) {
        val nextLyric = lyric?.trim().orEmpty()
        if (cachedMediaNotificationLyric == nextLyric) return
        cachedMediaNotificationLyric = nextLyric
        updateMediaSessionMetadata()
        updateNotification()
    }

    fun onLiveUpdateLyricEnabledChanged(enabled: Boolean) {
        if (MpvServiceBridge.useLiveUpdateLyricNotification == enabled) return
        MpvServiceBridge.useLiveUpdateLyricNotification = enabled
        if (enabled) {
            cachedMediaNotificationLyric = ""
            updateMediaSessionMetadata()
        } else {
            cachedLiveUpdateLyric = ""
        }
        updateNotification()
    }

    fun onLiveUpdateLyricChanged(lyric: String?): Boolean {
        val nextLyric = lyric?.trim().orEmpty()
        val previousLiveUpdateEnabled = MpvServiceBridge.useLiveUpdateLyricNotification
        if (nextLyric.isNotEmpty()) {
            MpvServiceBridge.useLiveUpdateLyricNotification = true
        } else {
            MpvServiceBridge.useLiveUpdateLyricNotification = false
        }
        val liveUpdateEnabledChanged =
            previousLiveUpdateEnabled != MpvServiceBridge.useLiveUpdateLyricNotification
        if (
            !liveUpdateEnabledChanged &&
            cachedLiveUpdateLyric == nextLyric &&
            cachedMediaNotificationLyric.isBlank()
        ) {
            return canOwnLiveUpdateNotification()
        }
        cachedLiveUpdateLyric = nextLyric
        cachedMediaNotificationLyric = ""
        updateMediaSessionMetadata()
        updateNotification()
        return canOwnLiveUpdateNotification()
    }

    private fun shouldTickLiveUpdateProgress(): Boolean =
        shouldUseLiveUpdateNotificationStyle() &&
            cachedState == PlaybackStateCompat.STATE_PLAYING

    private fun updateLiveUpdateProgressTicker() {
        if (shouldTickLiveUpdateProgress()) {
            scheduleLiveUpdateProgressTicker()
        } else {
            cancelLiveUpdateProgressTicker()
        }
    }

    private fun scheduleLiveUpdateProgressTicker() {
        if (liveUpdateProgressTickerScheduled || !shouldTickLiveUpdateProgress()) return
        liveUpdateProgressTickerScheduled = true
        mainHandler.postDelayed(liveUpdateProgressTicker, LIVE_UPDATE_PROGRESS_UPDATE_MS)
    }

    private fun cancelLiveUpdateProgressTicker() {
        if (!liveUpdateProgressTickerScheduled) return
        liveUpdateProgressTickerScheduled = false
        mainHandler.removeCallbacks(liveUpdateProgressTicker)
    }

    private fun currentNotificationPosition(): Long {
        if (
            cachedState != PlaybackStateCompat.STATE_PLAYING ||
            cachedPositionUpdatedAtMs <= 0L
        ) {
            return cachedPosition
        }

        val elapsed = (System.currentTimeMillis() - cachedPositionUpdatedAtMs).coerceAtLeast(0L)
        val estimated = cachedPosition + elapsed
        return if (cachedDuration > 0) {
            estimated.coerceIn(0L, cachedDuration)
        } else {
            estimated.coerceAtLeast(0L)
        }
    }

    private fun secondsToMillis(seconds: Double): Long =
        if (!seconds.isNaN() && !seconds.isInfinite() && seconds > 0) {
            (seconds * 1000).toLong()
        } else {
            0L
        }

    private fun updateAll() {
        updatePlaybackState()
        updateNotification()
    }

    private fun updateMediaSessionMetadata() {
        val displayTitle = cachedMediaNotificationLyric.ifBlank { cachedTitle }
        val displayArtist =
            if (cachedMediaNotificationLyric.isNotBlank()) {
                buildTrackIdentityText()
            } else {
                cachedArtist
            }
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, displayTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, displayArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, cachedAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, cachedDuration)

        cachedArtworkBitmap?.let { bitmap ->
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap)
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmap)
        }

        mediaSession.setMetadata(builder.build())
    }

    private fun buildTrackIdentityText(): String =
        buildString {
            if (cachedTitle.isNotBlank()) append(cachedTitle)
            if (cachedArtist.isNotBlank()) {
                if (isNotEmpty()) append(" - ")
                append(cachedArtist)
            }
            if (isEmpty() && cachedAlbum.isNotBlank()) append(cachedAlbum)
            if (isEmpty()) append("MusicFree")
        }

    private fun buildNotificationText(): String =
        if (cachedMediaNotificationLyric.isNotBlank()) {
            buildTrackIdentityText()
        } else {
            buildString {
                if (cachedArtist.isNotBlank()) append(cachedArtist)
                if (cachedAlbum.isNotBlank()) {
                    if (isNotEmpty()) append(" - ")
                    append(cachedAlbum)
                }
                if (isEmpty()) append("正在播放")
            }
        }

    private fun updatePlaybackState() {
        val speed =
            if (cachedState == PlaybackStateCompat.STATE_PLAYING) 1.0f else 0.0f
        val position = currentNotificationPosition()
        val activeQueueItemId: Long =
            if (MpvServiceBridge.currentQueueIndex >= 0) {
                MpvServiceBridge.currentQueueIndex.toLong()
            } else {
                -1L
            }
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(cachedState, position, speed)
                .setActions(allActions)
                .setBufferedPosition(cachedBufferedPosition)
                .setActiveQueueItemId(activeQueueItemId)
                .build(),
        )
    }

    private fun updateMediaSessionQueue(
        tracks: List<MpvQueueTrack>,
        currentIndex: Int,
    ) {
        if (!::mediaSession.isInitialized) return
        val queueItems =
            tracks.mapIndexed { index, track ->
                MediaSessionCompat.QueueItem(
                    MediaDescriptionCompat.Builder()
                        .setMediaId(track.id)
                        .setTitle(track.title.ifBlank { "未知歌曲" })
                        .setSubtitle(track.artist)
                        .setDescription(track.album)
                        .setIconUri(parseUriOrNull(track.artwork))
                        .build(),
                    index.toLong(),
                )
            }
        mediaSession.setQueue(queueItems)
        mediaSession.setQueueTitle("MusicFree Playback Queue")
        if (currentIndex != MpvServiceBridge.currentQueueIndex) {
            MpvServiceBridge.currentQueueIndex = currentIndex
        }
        updatePlaybackState()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        notificationManager?.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "MusicFree mpv 播放",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                setShowBadge(false)
            },
        )
    }

    private fun createMediaSession() {
        mediaSession = MediaSessionCompat(this, "MusicFreeMpv").apply {
            setCallback(
                object : MediaSessionCompat.Callback() {
                    override fun onPlay() {
                        MpvServiceBridge.onCommand?.invoke("play", null, null)
                    }

                    override fun onPause() {
                        MpvServiceBridge.onCommand?.invoke("pause", null, null)
                    }

                    override fun onSkipToNext() {
                        MpvServiceBridge.onCommand?.invoke("next", null, null)
                    }

                    override fun onSkipToPrevious() {
                        MpvServiceBridge.onCommand?.invoke("previous", null, null)
                    }

                    override fun onStop() {
                        MpvServiceBridge.onCommand?.invoke("stop", null, null)
                    }

                    override fun onSeekTo(pos: Long) {
                        MpvServiceBridge.onCommand?.invoke("seek", pos / 1000.0, null)
                    }

                    override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                        if (!mediaId.isNullOrBlank()) {
                            MpvServiceBridge.onCommand?.invoke("playFromId", null, mediaId)
                        }
                    }
                },
            )
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_NONE, 0, 1.0f)
                    .setActions(allActions)
                    .build(),
            )
            isActive = true
        }
        onQueueSnapshotChanged()
        MpvMediaBrowserService.getInstance()?.onPlaybackSessionReady()
    }

    private fun buildNotification(): Notification {
        val isPlaying =
            cachedState == PlaybackStateCompat.STATE_PLAYING ||
                cachedState == PlaybackStateCompat.STATE_BUFFERING
        val notificationPosition = currentNotificationPosition()
        val playIcon =
            if (isPlaying) R.drawable.ic_notification_pause else R.drawable.ic_notification_play
        val playLabel = if (isPlaying) "暂停" else "播放"

        val playIntent = PendingIntent.getService(
            this,
            101,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag(),
        )
        val prevIntent = PendingIntent.getService(
            this,
            102,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_PREV),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag(),
        )
        val nextIntent = PendingIntent.getService(
            this,
            103,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_NEXT),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag(),
        )
        val stopIntent = PendingIntent.getService(
            this,
            105,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag(),
        )
        val contentIntent = packageManager
            .getLaunchIntentForPackage(packageName)
            ?.let { launchIntent ->
                PendingIntent.getActivity(
                    this,
                    104,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag(),
                )
            }

        if (shouldUseLiveUpdateNotificationStyle()) {
            return buildLiveUpdateNotification(
                isPlaying,
                playIcon,
                playLabel,
                playIntent,
                prevIntent,
                nextIntent,
                stopIntent,
                contentIntent,
            )
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(
                cachedMediaNotificationLyric.ifBlank { cachedTitle.ifBlank { "MusicFree" } },
            )
            .setContentText(buildNotificationText())
            .setSmallIcon(R.drawable.ic_stat_musicfree)
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2),
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(NotificationCompat.Action(R.drawable.ic_notification_skip_previous, "上一首", prevIntent))
            .addAction(NotificationCompat.Action(playIcon, playLabel, playIntent))
            .addAction(NotificationCompat.Action(R.drawable.ic_notification_skip_next, "下一首", nextIntent))

        if (MpvServiceBridge.showStopAction) {
            builder.addAction(
                NotificationCompat.Action(
                    R.drawable.ic_notification_stop,
                    "关闭",
                    stopIntent,
                ),
            )
        }

        cachedArtworkBitmap?.let { builder.setLargeIcon(it) }
        contentIntent?.let { builder.setContentIntent(it) }

        if (cachedDuration > 0) {
            builder.setProgress(cachedDuration.toInt(), notificationPosition.toInt(), false)
            builder.setSubText("${formatTime(notificationPosition)} / ${formatTime(cachedDuration)}")
        }

        return builder.build().apply {
            if (MpvServiceBridge.useLiveUpdateLyricNotification) {
                extras.putBoolean("NOT_SHOW_MEDIA_NOTIFICATION_FLG", true)
                extras.putString("specialType", "")
            }
        }
    }

    private fun shouldUseLiveUpdateNotificationStyle(): Boolean =
        MpvServiceBridge.useLiveUpdateLyricNotification &&
            Build.VERSION.SDK_INT >= API_LIVE_UPDATE

    private fun canOwnLiveUpdateNotification(): Boolean =
        shouldUseLiveUpdateNotificationStyle() &&
            (
                isForeground ||
                    cachedState == PlaybackStateCompat.STATE_PLAYING ||
                    cachedState == PlaybackStateCompat.STATE_BUFFERING ||
                    cachedState == PlaybackStateCompat.STATE_PAUSED
                )

    private fun buildLiveUpdateNotification(
        isPlaying: Boolean,
        playIcon: Int,
        playLabel: String,
        playIntent: PendingIntent,
        prevIntent: PendingIntent,
        nextIntent: PendingIntent,
        stopIntent: PendingIntent,
        contentIntent: PendingIntent?,
    ): Notification {
        val notificationPosition = currentNotificationPosition()
        val title = cachedLiveUpdateLyric.ifBlank { cachedTitle.ifBlank { "MusicFree" } }
        val text =
            if (cachedLiveUpdateLyric.isNotBlank()) {
                buildTrackIdentityText()
            } else {
                buildNotificationText()
            }
        val progressPercent = progressPercent(notificationPosition, cachedDuration)
        val progressText =
            if (cachedDuration > 0) {
                "${formatTime(notificationPosition)} / ${formatTime(cachedDuration)}"
            } else {
                ""
            }
        val contentText =
            if (progressText.isNotBlank()) {
                listOf(text, progressText).filter { it.isNotBlank() }.joinToString(" · ")
            } else {
                text
            }
        val style = Notification.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressIndeterminate(cachedDuration <= 0)
        if (cachedDuration > 0) {
            style.setProgress(progressPercent)
        }

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_musicfree)
            .setContentTitle(title)
            .setContentText(contentText)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setShowWhen(false)
            .setColor(Color.TRANSPARENT)
            .setStyle(style)
            // 不再叠加 Builder 的旧式进度。官方文档明确 ProgressStyle 会覆盖
            // Builder.setProgress() 写入的 extras，两者不应同时使用；进度已由上面的
            // style.setProgress / setProgressIndeterminate 表达。
            //
            // 相关（非确证）：2026-08-19 22:26 真机上本通知 inflate 失败，系统抛
            // BadForegroundServiceNotificationException 直接杀掉进程：
            //   Couldn't inflate contentViews
            //   ArrayIndexOutOfBoundsException: src.length=44 srcPos=0 dst.length=44 dstPos=2 length=44
            // 该数组形状只是线索，尚不能排除 artwork 小图标 / promoted ongoing /
            // shortCriticalText 等其它组合在特定 ROM 上的缺陷。
            .setContentIntent(contentIntent)
            .addAction(Notification.Action.Builder(R.drawable.ic_notification_skip_previous, "上一首", prevIntent).build())
            .addAction(Notification.Action.Builder(playIcon, playLabel, playIntent).build())
            .addAction(Notification.Action.Builder(R.drawable.ic_notification_skip_next, "下一首", nextIntent).build())
            .apply {
                if (progressText.isNotBlank()) {
                    setSubText(progressText)
                }
                if (MpvServiceBridge.showStopAction) {
                    addAction(Notification.Action.Builder(R.drawable.ic_notification_stop, "关闭", stopIntent).build())
                }
                cachedArtworkBitmap?.let { setLiveUpdateArtworkIcons(it) }
                requestPromotedOngoing()
                setShortCriticalText(toChipText(title))
            }
            .build()
            .apply {
                extras.putBoolean("NOT_SHOW_MEDIA_NOTIFICATION_FLG", true)
                extras.putString("specialType", "")
            }
    }

    private fun Notification.Builder.requestPromotedOngoing(): Notification.Builder {
        try {
            javaClass
                .getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
                .invoke(this, true)
        } catch (_: Throwable) {
            addExtras(Bundle().apply {
                putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
            })
        }
        return this
    }

    private fun Notification.Builder.setLiveUpdateArtworkIcons(bitmap: Bitmap): Notification.Builder {
        setLargeIcon(bitmap)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                setSmallIcon(Icon.createWithBitmap(bitmap.toLiveUpdateSmallIconBitmap()))
            } catch (_: Throwable) {
            }
        }
        return this
    }

    private fun Bitmap.toLiveUpdateSmallIconBitmap(): Bitmap {
        val sourceSize = minOf(width, height)
        val left = (width - sourceSize) / 2
        val top = (height - sourceSize) / 2
        val src = Rect(left, top, left + sourceSize, top + sourceSize)
        val dstSize = 128
        val dst = Rect(0, 0, dstSize, dstSize)
        val output = Bitmap.createBitmap(dstSize, dstSize, Bitmap.Config.ARGB_8888)
        Canvas(output).drawBitmap(
            this,
            src,
            dst,
            Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
        )
        return output
    }

    private fun toChipText(text: String): String {
        val normalized = text.replace(Regex("\\s+"), " ").trim()
        if (normalized.isEmpty()) return ""
        if (normalized.codePointCount(0, normalized.length) <= CHIP_TEXT_MAX_CODE_POINTS) {
            return normalized
        }

        val builder = StringBuilder()
        var count = 0
        var index = 0
        val textLimit = (CHIP_TEXT_MAX_CODE_POINTS - 1).coerceAtLeast(0)
        while (index < normalized.length && count < textLimit) {
            val codePoint = normalized.codePointAt(index)
            builder.appendCodePoint(codePoint)
            index += Character.charCount(codePoint)
            count += 1
        }
        return builder.append(TRUNCATION_MARK).toString()
    }

    private fun progressPercent(position: Long, duration: Long): Int {
        if (duration <= 0) return 0
        return ((position.coerceIn(0L, duration) * 100L) / duration).toInt()
    }

    private fun updateNotification() {
        lastNotificationUpdateMs = System.currentTimeMillis()
        notificationManager?.notify(NOTIFICATION_ID, buildNotification())
        updateLiveUpdateProgressTicker()
    }

    private val wakeLockReleaseRunnable = Runnable {
        wakeLockReleaseScheduled = false
        releaseWakeLock()
    }

    private fun acquireWakeLock() {
        mainHandler.removeCallbacks(wakeLockReleaseRunnable)
        wakeLockReleaseScheduled = false
        val lock = wakeLock ?: try {
            val powerManager =
                getSystemService(Context.POWER_SERVICE) as? PowerManager
            powerManager
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
                ?.apply { setReferenceCounted(false) }
                ?.also { wakeLock = it }
        } catch (_: Exception) {
            null
        } ?: return
        if (!lock.isHeld) {
            try {
                lock.acquire()
            } catch (_: Exception) {
            }
        }
    }

    private fun scheduleWakeLockRelease() {
        if (wakeLock?.isHeld != true || wakeLockReleaseScheduled) {
            return
        }
        wakeLockReleaseScheduled = true
        mainHandler.postDelayed(wakeLockReleaseRunnable, WAKE_LOCK_GRACE_MS)
    }

    private fun releaseWakeLock() {
        mainHandler.removeCallbacks(wakeLockReleaseRunnable)
        wakeLockReleaseScheduled = false
        val lock = wakeLock ?: return
        if (lock.isHeld) {
            try {
                lock.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun startForegroundSafely() {
        if (isForeground) {
            updateNotification()
            return
        }

        try {
            startForeground(NOTIFICATION_ID, buildNotification())
            isForeground = true
        } catch (_: Exception) {
            notificationManager?.notify(NOTIFICATION_ID, buildNotification())
        }
    }

    private fun stopForegroundSafely() {
        if (isForeground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
            } catch (_: Exception) {
            }
            isForeground = false
        }
        cancelLiveUpdateProgressTicker()
        notificationManager?.cancel(NOTIFICATION_ID)
    }

    private fun requestAudioFocus() {
        if (audioFocusListener == null) {
            audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
                // 外部 App 抢焦点导致的暂停，和我们自己的 bug 造成的暂停，在用户
                // 看来都是「突然不放了」。之前唯一的分辨手段是 dumpsys audio 的
                // 焦点历史，而那个缓冲区会滚动——晚查一会儿证据就没了。
                // 这里留一条自带上下文的记录，事后可直接定性。
                val focusName = when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> "LOSS"
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> "LOSS_TRANSIENT"
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                        "LOSS_TRANSIENT_CAN_DUCK"
                    AudioManager.AUDIOFOCUS_GAIN -> "GAIN"
                    else -> "OTHER($change)"
                }
                Log.w(
                    TAG,
                    "audio focus $focusName: state=$cachedState " +
                        "playing=${cachedState == PlaybackStateCompat.STATE_PLAYING} " +
                        "pausedForTransient=$pausedForTransientFocusLoss " +
                        "ducked=$duckedForFocusLoss " +
                        "duckMode=${MpvServiceBridge.remoteDuckMode}",
                )
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        pausedForTransientFocusLoss = false
                        if (duckedForFocusLoss) {
                            duckedForFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("unduck", null, null)
                        }
                        MpvServiceBridge.onCommand?.invoke("pause", null, null)
                        abandonAudioFocus()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                        if (cachedState == PlaybackStateCompat.STATE_PLAYING) {
                            pausedForTransientFocusLoss = true
                            MpvServiceBridge.onCommand?.invoke("pause", null, null)
                        }
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        if (cachedState == PlaybackStateCompat.STATE_PLAYING) {
                            if (MpvServiceBridge.remoteDuckMode == "lowerVolume") {
                                duckedForFocusLoss = true
                                MpvServiceBridge.onCommand?.invoke(
                                    "duck",
                                    MpvServiceBridge.remoteDuckVolume,
                                    null,
                                )
                            } else {
                                pausedForTransientFocusLoss = true
                                MpvServiceBridge.onCommand?.invoke("pause", null, null)
                            }
                        }
                    }
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        if (duckedForFocusLoss) {
                            duckedForFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("unduck", null, null)
                        }
                        if (pausedForTransientFocusLoss) {
                            pausedForTransientFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("play", null, null)
                        }
                    }
                }
            }
        }
        audioManager?.requestAudioFocus(
            audioFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN,
        )
    }

    private fun abandonAudioFocus() {
        audioFocusListener?.let { audioManager?.abandonAudioFocus(it) }
        audioFocusListener = null
        pausedForTransientFocusLoss = false
        if (duckedForFocusLoss) {
            duckedForFocusLoss = false
            MpvServiceBridge.onCommand?.invoke("unduck", null, null)
        }
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiverRegistered) {
            return
        }
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(noisyReceiver, filter)
        }
        noisyReceiverRegistered = true
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            return
        }
        try {
            unregisterReceiver(noisyReceiver)
        } catch (_: Exception) {
        }
        noisyReceiverRegistered = false
    }

    private fun loadArtworkAsync(url: String) {
        artworkExecutor.execute artwork@{
            val bitmap = fetchBitmap(url)
            if (bitmap == null) {
                // 封面失败会让灵动岛/锁屏退回默认小图标，和「JS 没给 artwork」
                // 在界面上完全一样。这条路径以前全程无日志，三种成因（策略拒绝、
                // 网络失败、解码失败）事后无法区分，所以失败必须留痕。
                Log.w(TAG, "artwork load failed: ${describeArtworkUrl(url)}")
                return@artwork
            }
            mainHandler.post {
                if (url != cachedArtwork) {
                    return@post
                }
                cachedArtworkBitmap = bitmap
                updateMediaSessionMetadata()
                updateNotification()
            }
        }
    }

    /** 只暴露形状（scheme/host/长度），不打完整 URL——里面常带签名票据。 */
    private fun describeArtworkUrl(url: String): String {
        val scheme = url.substringBefore("://", "").ifEmpty { "path" }
        val host = runCatching {
            if (scheme == "http" || scheme == "https") {
                url.toHttpUrlOrNull()?.host ?: "?"
            } else {
                "-"
            }
        }.getOrDefault("?")
        return "scheme=$scheme host=$host len=${url.length}"
    }

    private fun fetchBitmap(url: String): Bitmap? {
        return try {
            when {
                url.startsWith("http://") || url.startsWith("https://") -> {
                    val request = Request.Builder()
                        .url(PublicHttpsNetworkPolicy.requirePublicRemote(url))
                        .get()
                        .build()
                    artworkHttpClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            Log.w(
                                TAG,
                                "artwork http ${response.code}: " +
                                    describeArtworkUrl(url),
                            )
                            null
                        } else {
                            val input = response.body?.byteStream()
                                ?: return@use null
                            val bytes = input.use {
                                readBoundedBytes(it, MAX_ARTWORK_DOWNLOAD_BYTES)
                            }
                            decodeSampledBitmap(bytes).also {
                                if (it == null) {
                                    Log.w(
                                        TAG,
                                        "artwork decode failed: bytes=${bytes.size} " +
                                            describeArtworkUrl(url),
                                    )
                                }
                            }
                        }
                    }
                }
                url.startsWith("content://") ||
                    url.startsWith("file://") ||
                    url.startsWith("android.resource://") -> {
                    decodeSampledBitmap(Uri.parse(url))
                }
                else -> decodeSampledFile(url)
            }
        } catch (e: Throwable) {
            // 包含 PublicHttpsNetworkPolicy 的 IllegalArgumentException（私有地址/
            // 带凭据的 URL）和跨域重定向被拒——这些都只在这里才能看出来。
            Log.w(TAG, "artwork fetch threw: ${describeArtworkUrl(url)}", e)
            null
        }
    }

    private fun readBoundedBytes(
        input: java.io.InputStream,
        maxBytes: Int,
    ): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) {
                break
            }
            total += read
            if (total > maxBytes) {
                throw IllegalArgumentException("artwork is too large")
            }
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun decodeSampledBitmap(bytes: ByteArray): Bitmap? {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            return null
        }
        options.inJustDecodeBounds = false
        options.inSampleSize = calculateInSampleSize(options.outWidth, options.outHeight)
        return scaleArtworkBitmap(
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options),
        )
    }

    private fun decodeSampledBitmap(uri: Uri): Bitmap? {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        }
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            return null
        }
        options.inJustDecodeBounds = false
        options.inSampleSize = calculateInSampleSize(options.outWidth, options.outHeight)
        return contentResolver.openInputStream(uri)?.use {
            scaleArtworkBitmap(BitmapFactory.decodeStream(it, null, options))
        }
    }

    private fun decodeSampledFile(path: String): Bitmap? {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeFile(path, options)
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            return null
        }
        options.inJustDecodeBounds = false
        options.inSampleSize = calculateInSampleSize(options.outWidth, options.outHeight)
        return scaleArtworkBitmap(BitmapFactory.decodeFile(path, options))
    }

    private fun calculateInSampleSize(width: Int, height: Int): Int {
        var sampleSize = 1
        var sampledWidth = width
        var sampledHeight = height
        while (
            sampledWidth / 2 >= MAX_ARTWORK_DECODE_SIZE &&
            sampledHeight / 2 >= MAX_ARTWORK_DECODE_SIZE
        ) {
            sampleSize *= 2
            sampledWidth /= 2
            sampledHeight /= 2
        }
        return sampleSize
    }

    private fun scaleArtworkBitmap(bitmap: Bitmap?): Bitmap? {
        bitmap ?: return null
        val maxSide = max(bitmap.width, bitmap.height)
        if (maxSide <= MAX_ARTWORK_DECODE_SIZE) {
            return bitmap
        }
        val scale = MAX_ARTWORK_DECODE_SIZE.toFloat() / maxSide.toFloat()
        val targetWidth = max(1, (bitmap.width * scale).toInt())
        val targetHeight = max(1, (bitmap.height * scale).toInt())
        val scaled = Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
        if (scaled != bitmap) {
            bitmap.recycle()
        }
        return scaled
    }

    private fun parseUriOrNull(value: String?): Uri? =
        try {
            value?.takeIf { it.isNotBlank() }?.let { Uri.parse(it) }
        } catch (_: Exception) {
            null
        }
}
