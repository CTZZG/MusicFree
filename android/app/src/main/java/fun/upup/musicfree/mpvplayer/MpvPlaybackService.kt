package `fun`.upup.musicfree.mpvplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * 前台服务：MediaSession + 通知栏 + 音频焦点。
 *
 * 通知按钮通过 PendingIntent.getService 直接回调 onStartCommand，
 * 不走广播/MediaButtonReceiver，避免循环。
 */
class MpvPlaybackService : Service() {

    companion object {
        private const val TAG = "MpvPlaybackSvc"
        private const val CHANNEL_ID = "musicfree_mpv_playback"
        private const val NOTIFICATION_ID = 3001

        // 通知按钮 action（Intent action，由 onStartCommand 分发）
        private const val ACTION_PLAY_PAUSE = "mpv_play_pause"
        private const val ACTION_NEXT = "mpv_next"
        private const val ACTION_PREV = "mpv_prev"

        private fun formatTime(ms: Long): String {
            val totalSec = ms / 1000
            return "${totalSec / 60}:${(totalSec % 60).toString().padStart(2, '0')}"
        }

        private fun pendingIntentFlag(): Int =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    }

    private lateinit var mediaSession: MediaSessionCompat
    private var notificationManager: NotificationManager? = null
    private var audioManager: AudioManager? = null
    private var audioFocusListener: AudioManager.OnAudioFocusChangeListener? = null
    private var isForeground = false

    private var cachedTitle = ""
    private var cachedArtist = ""
    private var cachedAlbum = ""
    private var cachedArtwork: String? = null
    private var cachedDuration = 0L
    private var cachedPosition = 0L
    private var cachedState = PlaybackStateCompat.STATE_NONE

    private val allActions: Long =
        PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SEEK_TO

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        MpvServiceBridge.service = this
        createNotificationChannel()
        createMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 通知按钮 → PendingIntent.getService → onStartCommand
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> {
                if (cachedState == PlaybackStateCompat.STATE_PLAYING)
                    MpvServiceBridge.onCommand?.invoke("pause", null)
                else
                    MpvServiceBridge.onCommand?.invoke("play", null)
            }
            ACTION_NEXT -> MpvServiceBridge.onCommand?.invoke("next", null)
            ACTION_PREV -> MpvServiceBridge.onCommand?.invoke("previous", null)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        MpvServiceBridge.service = null
        stopForegroundSafely()
        mediaSession.release()
        abandonAudioFocus()
        super.onDestroy()
    }

    // ═══════════════════════════════════════════
    // Bridge API
    // ═══════════════════════════════════════════

    fun onMetadataChanged(title: String, artist: String, album: String, artwork: String?, durationSecs: Double) {
        cachedTitle = title; cachedArtist = artist; cachedAlbum = album; cachedArtwork = artwork
        cachedDuration = (durationSecs * 1000).toLong()
        val m = android.support.v4.media.MediaMetadataCompat.Builder()
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DURATION, cachedDuration)
        mediaSession.setMetadata(m.build())
        if (!artwork.isNullOrBlank()) loadArtworkAsync(artwork)
        updateAll()
    }

    fun onPlaybackStateChanged(state: String) {
        when (state) {
            "playing" -> {
                requestAudioFocus()
                startForegroundSafely()
                cachedState = PlaybackStateCompat.STATE_PLAYING
                updateAll()
            }
            "paused" -> {
                cachedState = PlaybackStateCompat.STATE_PAUSED
                updateAll()
            }
            "error", "idle" -> {
                abandonAudioFocus()
                cachedState = PlaybackStateCompat.STATE_STOPPED
                updateAll()
            }
            // ended / buffering 是瞬态，不更新（避免系统释放音频焦点）
            else -> {}
        }
    }

    fun onProgressChanged(positionSecs: Double, durationSecs: Double) {
        cachedPosition = (positionSecs * 1000).toLong()
        val hadDuration = cachedDuration > 0
        if (durationSecs > 0) cachedDuration = (durationSecs * 1000).toLong()
        updatePlaybackState()
        if (!hadDuration && cachedDuration > 0) updateNotification()
    }

    // ═══════════════════════════════════════════
    // internal
    // ═══════════════════════════════════════════

    private fun updateAll() { updatePlaybackState(); updateNotification() }

    private fun updatePlaybackState() {
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(cachedState, cachedPosition, 1.0f)
                .setActions(allActions)
                .setBufferedPosition(cachedPosition)
                .build()
        )
    }

    private fun createNotificationChannel() {
        notificationManager?.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "MusicFree mpv 播放", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            }
        )
    }

    private fun createMediaSession() {
        mediaSession = MediaSessionCompat(this, "MusicFreeMpv").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() { MpvServiceBridge.onCommand?.invoke("play", null) }
                override fun onPause() { MpvServiceBridge.onCommand?.invoke("pause", null) }
                override fun onSkipToNext() { MpvServiceBridge.onCommand?.invoke("next", null) }
                override fun onSkipToPrevious() { MpvServiceBridge.onCommand?.invoke("previous", null) }
                override fun onStop() { MpvServiceBridge.onCommand?.invoke("stop", null) }
                override fun onSeekTo(pos: Long) { MpvServiceBridge.onCommand?.invoke("seek", pos / 1000.0) }
            })
            setPlaybackState(PlaybackStateCompat.Builder().setState(PlaybackStateCompat.STATE_NONE, 0, 1.0f).setActions(allActions).build())
            isActive = true
        }
    }

    private fun buildNotification(): Notification {
        val isPlaying = cachedState == PlaybackStateCompat.STATE_PLAYING
        val playIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playLabel = if (isPlaying) "暂停" else "播放"

        val playPI = PendingIntent.getService(this, 101,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag())
        val prevPI = PendingIntent.getService(this, 102,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_PREV),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag())
        val nextPI = PendingIntent.getService(this, 103,
            Intent(this, MpvPlaybackService::class.java).setAction(ACTION_NEXT),
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentFlag())

        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(cachedTitle.ifBlank { "MusicFree" })
            .setContentText(buildString {
                if (cachedArtist.isNotBlank()) append(cachedArtist)
                if (cachedAlbum.isNotBlank()) { if (isNotEmpty()) append(" - "); append(cachedAlbum) }
                if (isEmpty()) append("正在播放")
            })
            .setSmallIcon(resources.getIdentifier("ic_launcher", "mipmap", packageName).takeIf { it != 0 } ?: android.R.drawable.ic_media_play)
            .setStyle(androidx.media.app.NotificationCompat.MediaStyle().setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_previous, "上一首", prevPI))
            .addAction(NotificationCompat.Action(playIcon, playLabel, playPI))
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_next, "下一首", nextPI))

        if (cachedDuration > 0) {
            b.setProgress(cachedDuration.toInt(), cachedPosition.toInt(), false)
            b.setSubText("${formatTime(cachedPosition)} / ${formatTime(cachedDuration)}")
        }
        return b.build()
    }

    private fun updateNotification() {
        notificationManager?.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun startForegroundSafely() {
        if (isForeground) { updateNotification(); return }
        try {
            startForeground(NOTIFICATION_ID, buildNotification())
            isForeground = true
        } catch (_: Exception) {
            notificationManager?.notify(NOTIFICATION_ID, buildNotification())
        }
    }

    private fun stopForegroundSafely() {
        if (isForeground) { try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}; isForeground = false }
        notificationManager?.cancel(NOTIFICATION_ID)
    }

    // ═══════════════════════════════════════════
    // audio focus
    // ═══════════════════════════════════════════

    private fun requestAudioFocus() {
        audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> { MpvServiceBridge.onCommand?.invoke("pause", null); abandonAudioFocus() }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> MpvServiceBridge.onCommand?.invoke("pause", null)
                else -> {}
            }
        }
        audioManager?.requestAudioFocus(audioFocusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }

    private fun abandonAudioFocus() {
        audioFocusListener?.let { audioManager?.abandonAudioFocus(it) }
        audioFocusListener = null
    }

    // ═══════════════════════════════════════════
    // artwork
    // ═══════════════════════════════════════════

    private fun loadArtworkAsync(url: String) {
        thread {
            try {
                val bmp = fetchBitmap(url) ?: return@thread
                val m = android.support.v4.media.MediaMetadataCompat.Builder()
                    .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE, cachedTitle)
                    .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST, cachedArtist)
                    .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM, cachedAlbum)
                    .putLong(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DURATION, cachedDuration)
                    .putBitmap(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
                mediaSession.setMetadata(m.build())
                updateNotification()
            } catch (_: Exception) {}
        }
    }

    private fun fetchBitmap(url: String): Bitmap? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 5000; c.doInput = true; c.connect()
        BitmapFactory.decodeStream(c.inputStream)
    } catch (_: Exception) { null }
}
