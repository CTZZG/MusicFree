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
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import `fun`.upup.musicfree.R
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
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
        private const val CHANNEL_ID = "musicfree_mpv_playback"
        private const val NOTIFICATION_ID = 3001
        private const val NOTIFICATION_PROGRESS_UPDATE_MS = 1000L

        private const val ACTION_PLAY_PAUSE = "mpv_play_pause"
        private const val ACTION_NEXT = "mpv_next"
        private const val ACTION_PREV = "mpv_prev"
        private const val ACTION_STOP = "mpv_stop"

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
    private val mainHandler = Handler(Looper.getMainLooper())
    private var notificationManager: NotificationManager? = null
    private var audioManager: AudioManager? = null
    private var audioFocusListener: AudioManager.OnAudioFocusChangeListener? = null
    private var isForeground = false
    private var noisyReceiverRegistered = false
    private var pausedForTransientFocusLoss = false
    private var duckedForFocusLoss = false
    private var lastNotificationUpdateMs = 0L

    private var cachedTitle = ""
    private var cachedArtist = ""
    private var cachedAlbum = ""
    private var cachedArtwork: String? = null
    private var cachedArtworkBitmap: Bitmap? = null
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
            PlaybackStateCompat.ACTION_SEEK_TO

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (
                intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY &&
                cachedState == PlaybackStateCompat.STATE_PLAYING
            ) {
                MpvServiceBridge.onCommand?.invoke("pause", null)
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
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> {
                if (
                    cachedState == PlaybackStateCompat.STATE_PLAYING ||
                    cachedState == PlaybackStateCompat.STATE_BUFFERING
                ) {
                    MpvServiceBridge.onCommand?.invoke("pause", null)
                } else {
                    MpvServiceBridge.onCommand?.invoke("play", null)
                }
            }
            ACTION_NEXT -> MpvServiceBridge.onCommand?.invoke("next", null)
            ACTION_PREV -> MpvServiceBridge.onCommand?.invoke("previous", null)
            ACTION_STOP -> MpvServiceBridge.onCommand?.invoke("stop", null)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        MpvServiceBridge.service = null
        unregisterNoisyReceiver()
        stopForegroundSafely()
        mediaSession.release()
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
            cachedArtworkBitmap = null
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
                requestAudioFocus()
                startForegroundSafely()
                cachedState = PlaybackStateCompat.STATE_PLAYING
                updateAll()
            }
            "buffering" -> {
                requestAudioFocus()
                startForegroundSafely()
                cachedState = PlaybackStateCompat.STATE_BUFFERING
                updateAll()
            }
            "paused" -> {
                cachedState = PlaybackStateCompat.STATE_PAUSED
                updateAll()
            }
            "ended" -> {
                cachedState = PlaybackStateCompat.STATE_PAUSED
                updateAll()
            }
            "error", "idle" -> {
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
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, cachedTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, cachedArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, cachedAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, cachedDuration)

        cachedArtworkBitmap?.let { bitmap ->
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap)
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmap)
        }

        mediaSession.setMetadata(builder.build())
    }

    private fun updatePlaybackState() {
        val speed =
            if (cachedState == PlaybackStateCompat.STATE_PLAYING) 1.0f else 0.0f
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(cachedState, cachedPosition, speed)
                .setActions(allActions)
                .setBufferedPosition(cachedBufferedPosition)
                .build(),
        )
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
                        MpvServiceBridge.onCommand?.invoke("play", null)
                    }

                    override fun onPause() {
                        MpvServiceBridge.onCommand?.invoke("pause", null)
                    }

                    override fun onSkipToNext() {
                        MpvServiceBridge.onCommand?.invoke("next", null)
                    }

                    override fun onSkipToPrevious() {
                        MpvServiceBridge.onCommand?.invoke("previous", null)
                    }

                    override fun onStop() {
                        MpvServiceBridge.onCommand?.invoke("stop", null)
                    }

                    override fun onSeekTo(pos: Long) {
                        MpvServiceBridge.onCommand?.invoke("seek", pos / 1000.0)
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
    }

    private fun buildNotification(): Notification {
        val isPlaying =
            cachedState == PlaybackStateCompat.STATE_PLAYING ||
                cachedState == PlaybackStateCompat.STATE_BUFFERING
        val playIcon =
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
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

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(cachedTitle.ifBlank { "MusicFree" })
            .setContentText(
                buildString {
                    if (cachedArtist.isNotBlank()) append(cachedArtist)
                    if (cachedAlbum.isNotBlank()) {
                        if (isNotEmpty()) append(" - ")
                        append(cachedAlbum)
                    }
                    if (isEmpty()) append("正在播放")
                },
            )
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
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_previous, "上一首", prevIntent))
            .addAction(NotificationCompat.Action(playIcon, playLabel, playIntent))
            .addAction(NotificationCompat.Action(android.R.drawable.ic_media_next, "下一首", nextIntent))

        if (MpvServiceBridge.showStopAction) {
            builder.addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "关闭",
                    stopIntent,
                ),
            )
        }

        cachedArtworkBitmap?.let { builder.setLargeIcon(it) }
        contentIntent?.let { builder.setContentIntent(it) }

        if (cachedDuration > 0) {
            builder.setProgress(cachedDuration.toInt(), cachedPosition.toInt(), false)
            builder.setSubText("${formatTime(cachedPosition)} / ${formatTime(cachedDuration)}")
        }

        return builder.build()
    }

    private fun updateNotification() {
        lastNotificationUpdateMs = System.currentTimeMillis()
        notificationManager?.notify(NOTIFICATION_ID, buildNotification())
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
        notificationManager?.cancel(NOTIFICATION_ID)
    }

    private fun requestAudioFocus() {
        if (audioFocusListener == null) {
            audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        pausedForTransientFocusLoss = false
                        if (duckedForFocusLoss) {
                            duckedForFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("unduck", null)
                        }
                        MpvServiceBridge.onCommand?.invoke("pause", null)
                        abandonAudioFocus()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                        if (cachedState == PlaybackStateCompat.STATE_PLAYING) {
                            pausedForTransientFocusLoss = true
                            MpvServiceBridge.onCommand?.invoke("pause", null)
                        }
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        if (cachedState == PlaybackStateCompat.STATE_PLAYING) {
                            if (MpvServiceBridge.remoteDuckMode == "lowerVolume") {
                                duckedForFocusLoss = true
                                MpvServiceBridge.onCommand?.invoke(
                                    "duck",
                                    MpvServiceBridge.remoteDuckVolume,
                                )
                            } else {
                                pausedForTransientFocusLoss = true
                                MpvServiceBridge.onCommand?.invoke("pause", null)
                            }
                        }
                    }
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        if (duckedForFocusLoss) {
                            duckedForFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("unduck", null)
                        }
                        if (pausedForTransientFocusLoss) {
                            pausedForTransientFocusLoss = false
                            MpvServiceBridge.onCommand?.invoke("play", null)
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
            MpvServiceBridge.onCommand?.invoke("unduck", null)
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
        thread {
            val bitmap = fetchBitmap(url) ?: return@thread
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

    private fun fetchBitmap(url: String): Bitmap? =
        try {
            when {
                url.startsWith("http://") || url.startsWith("https://") -> {
                    val connection = URL(url).openConnection() as HttpURLConnection
                    connection.connectTimeout = 5000
                    connection.readTimeout = 5000
                    connection.doInput = true
                    connection.connect()
                    try {
                        connection.inputStream.use { BitmapFactory.decodeStream(it) }
                    } finally {
                        connection.disconnect()
                    }
                }
                url.startsWith("content://") ||
                    url.startsWith("file://") ||
                    url.startsWith("android.resource://") -> {
                    contentResolver.openInputStream(Uri.parse(url))?.use {
                        BitmapFactory.decodeStream(it)
                    }
                }
                else -> BitmapFactory.decodeFile(url)
            }
        } catch (_: Exception) {
            null
        }
}
