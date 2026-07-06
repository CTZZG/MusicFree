package `fun`.upup.musicfree.lyricUtil

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import `fun`.upup.musicfree.R

class LiveUpdateLyricNotifier(private val appContext: Context) {
    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private var lastLyric = ""
    private var lastPromotable = false
    private var lastCanPostPromoted = false
    private var posted = false

    fun show(lyric: String) {
        val text = lyric.trim()
        if (text.isEmpty() || Build.VERSION.SDK_INT < API_LIVE_UPDATE) {
            clear()
            return
        }
        if (text == lastLyric && posted) return

        createChannel()
        val notification = buildNotification(text)
        lastLyric = text
        lastPromotable = notification.hasPromotableCharacteristics()
        lastCanPostPromoted = notificationManager.canPostPromotedNotifications()
        posted = true

        Log.d(
            TAG,
            "post lyric live update, promotable=$lastPromotable, canPostPromoted=$lastCanPostPromoted",
        )
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    fun clear() {
        lastLyric = ""
        lastPromotable = false
        posted = false
        notificationManager.cancel(NOTIFICATION_ID)
    }

    fun status(): WritableMap {
        val map = Arguments.createMap()
        map.putBoolean("supported", Build.VERSION.SDK_INT >= API_LIVE_UPDATE)
        map.putBoolean(
            "canPostPromotedNotifications",
            Build.VERSION.SDK_INT >= API_LIVE_UPDATE &&
                notificationManager.canPostPromotedNotifications(),
        )
        map.putBoolean("lastPromotable", lastPromotable)
        map.putBoolean("posted", posted)
        map.putString("lastLyric", lastLyric)
        return map
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "MusicFree Live Update 歌词",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "用于在 Android 16 Live Update/灵动胶囊中实验显示歌词"
            enableLights(false)
            enableVibration(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        notificationManager.createNotificationChannel(channel)
    }

    private fun buildNotification(lyric: String): Notification {
        val launchIntent = appContext.packageManager
            .getLaunchIntentForPackage(appContext.packageName)
            ?.apply {
                addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                appContext,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val style = Notification.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressIndeterminate(true)

        return Notification.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_musicfree)
            .setContentTitle(lyric)
            .setContentText("MusicFree")
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setShowWhen(false)
            .setColor(Color.TRANSPARENT)
            .setStyle(style)
            .setProgress(100, 0, true)
            .setContentIntent(contentIntent)
            .requestPromotedOngoing()
            .setShortCriticalText(toChipText(lyric))
            .build()
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

    private fun toChipText(lyric: String): String {
        val normalized = lyric.replace(Regex("\\s+"), " ").trim()
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

    companion object {
        private const val TAG = "LiveUpdateLyric"
        private const val API_LIVE_UPDATE = 36
        private const val CHANNEL_ID = "musicfree_live_update_lyric"
        private const val NOTIFICATION_ID = 20260701
        private const val CHIP_TEXT_MAX_CODE_POINTS = 12
        private const val TRUNCATION_MARK = "…"
        private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
    }
}
