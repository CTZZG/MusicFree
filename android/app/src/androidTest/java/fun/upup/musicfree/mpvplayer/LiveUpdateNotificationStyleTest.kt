package `fun`.upup.musicfree.mpvplayer

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * 真实的播放服务发出的通知：开着 Live Update 歌词时，当前这句变空（前奏、间奏、
 * 换歌）通知仍是进度样式，标题换回歌名；只有关掉开关才换回媒体样式。以前一变空就
 * 换回媒体样式，同一条通知来回换，荣耀的实况卡片会留下一大块空白。
 */
class LiveUpdateNotificationStyleTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @Test
    fun anEmptyLyricLineKeepsTheLiveUpdateStyle() {
        assumeTrue("Live Update needs Android 16", Build.VERSION.SDK_INT >= 36)
        instrumentation.uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.POST_NOTIFICATIONS,
        )
        val connected = CountDownLatch(1)
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder?) { connected.countDown() }
            override fun onServiceDisconnected(name: ComponentName) {}
            override fun onNullBinding(name: ComponentName) { connected.countDown() }
        }
        val intent = Intent(context, MpvPlaybackService::class.java)
        var bound = false
        var playbackService: MpvPlaybackService? = null
        try {
            bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            assertTrue("Playback service must bind", bound)
            assertTrue("Playback service must initialize", connected.await(10, TimeUnit.SECONDS))
            val service = requireNotNull(MpvServiceBridge.service)
            playbackService = service

            instrumentation.runOnMainSync {
                service.onLiveUpdateLyricEnabledChanged(true)
                service.onMetadataChanged("大城小爱", "王力宏", "盖世英雄", null, 245.0)
                service.onPlaybackStateChanged("playing")
                service.onLiveUpdateLyricChanged("屋顶灰色瓦片 安静的画面")
            }
            awaitNotification("first lyric line") {
                it.template() == PROGRESS_STYLE && it.title() == "屋顶灰色瓦片 安静的画面"
            }.also(::assertActionIconsCarryThePackage)

            // 间奏：JS 清掉这一句。仍是 Live Update，标题换回歌名
            instrumentation.runOnMainSync { service.onLiveUpdateLyricChanged(null) }
            awaitNotification("lyric cleared") {
                it.template() == PROGRESS_STYLE && it.title() == "大城小爱"
            }.also(::assertActionIconsCarryThePackage)

            // 换歌：新的一首还没有歌词，也不换样式
            instrumentation.runOnMainSync {
                service.onMetadataChanged("唯一", "王力宏", "唯一", null, 260.0)
                service.onLiveUpdateLyricChanged("")
            }
            awaitNotification("next track before its first line") {
                it.template() == PROGRESS_STYLE && it.title() == "唯一"
            }

            // 只有关掉开关才换回媒体样式
            instrumentation.runOnMainSync { service.onLiveUpdateLyricEnabledChanged(false) }
            awaitNotification("Live Update switched off") {
                it.template() == MEDIA_STYLE && it.title() == "唯一"
            }

            instrumentation.runOnMainSync { service.onPlaybackStateChanged("idle") }
        } finally {
            // 开关记在进程里，别留给后面的测试
            playbackService?.let { service ->
                instrumentation.runOnMainSync { service.onLiveUpdateLyricEnabledChanged(false) }
            }
            if (bound) context.unbindService(connection)
            context.stopService(intent)
        }
    }

    private fun awaitNotification(
        what: String,
        predicate: (Notification) -> Boolean,
    ): Notification {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var last: Notification? = null
        while (System.nanoTime() < deadline) {
            last = notificationManager.activeNotifications
                .firstOrNull { it.id == PLAYBACK_NOTIFICATION_ID }
                ?.notification
            if (last != null && predicate(last)) return last
            Thread.sleep(50)
        }
        throw AssertionError(
            "$what: expected notification not posted; last template=${last?.template()} " +
                "title=${last?.title()}",
        )
    }

    private fun assertActionIconsCarryThePackage(notification: Notification) {
        val actions = notification.actions
        assertNotNull("Live Update has playback buttons", actions)
        assertEquals(listOf("上一首", "暂停", "下一首"), actions.take(3).map { it.title.toString() })
        for (action in actions) {
            assertEquals(
                "${action.title} icon names this app's package",
                context.packageName,
                action.getIcon().resPackage,
            )
        }
    }

    private fun Notification.template(): String? = extras.getString(Notification.EXTRA_TEMPLATE)

    private fun Notification.title(): String? =
        extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()

    private companion object {
        // MpvPlaybackService.NOTIFICATION_ID
        const val PLAYBACK_NOTIFICATION_ID = 3001
        const val PROGRESS_STYLE = "android.app.Notification\$ProgressStyle"
        const val MEDIA_STYLE = "android.app.Notification\$MediaStyle"
    }
}
