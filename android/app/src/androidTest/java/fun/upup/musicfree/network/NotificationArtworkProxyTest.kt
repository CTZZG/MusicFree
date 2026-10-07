package `fun`.upup.musicfree.network

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import `fun`.upup.musicfree.mpvplayer.MpvPlaybackService
import `fun`.upup.musicfree.mpvplayer.MpvServiceBridge
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exercises the real service fetch, Bitmap decoding and MediaSession update. */
class NotificationArtworkProxyTest {
    @Test
    fun artworkReachesMediaSessionThroughSystemLoopbackProxy() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val originalSelector = ProxySelector.getDefault()
        val connected = CountDownLatch(1)
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) { connected.countDown() }
            override fun onServiceDisconnected(name: ComponentName) {}
            override fun onNullBinding(name: ComponentName) { connected.countDown() }
        }
        val intent = Intent(context, MpvPlaybackService::class.java)
        var bound = false
        MockWebServer().use { server ->
            server.start()
            val image = Base64.decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNQaHjwHxkzkC4AADaHJ/HO9Z+HAAAAAElFTkSuQmCC",
                Base64.DEFAULT,
            )
            server.enqueue(MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(image)))
            val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", server.port))
            ProxySelector.setDefault(object : ProxySelector() {
                override fun select(uri: URI) = listOf(proxy)
                override fun connectFailed(uri: URI, sa: SocketAddress, ioe: IOException) {}
            })
            try {
                bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
                assertTrue("Playback service must bind", bound)
                assertTrue("Playback service must initialize", connected.await(10, TimeUnit.SECONDS))
                val service = requireNotNull(MpvServiceBridge.service)
                instrumentation.runOnMainSync {
                    service.onMetadataChanged("Proxy artwork test", "Test", "Test", "http://public.test/cover.png", 60.0)
                }
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                while (MpvServiceBridge.artworkStatus?.state != "loaded" && System.nanoTime() < deadline) {
                    Thread.sleep(50)
                }
                assertEquals(MpvServiceBridge.artworkStatus?.reason, "loaded", MpvServiceBridge.artworkStatus?.state)
                val controller = MediaControllerCompat(context, requireNotNull(service.mediaSessionTokenOrNull()))
                var metadata: MediaMetadataCompat? = null
                instrumentation.runOnMainSync {
                    metadata = controller.metadata
                }
                val bitmap = metadata?.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART)
                assertNotNull("The decoded artwork must reach MediaSession", bitmap)
                assertEquals(4, bitmap?.width)
                assertNotNull(metadata?.getBitmap(MediaMetadataCompat.METADATA_KEY_ART))
                assertEquals(1, server.requestCount)
            } finally {
                if (bound) context.unbindService(connection)
                context.stopService(intent)
                ProxySelector.setDefault(originalSelector)
                MpvServiceBridge.artworkStatus = null
            }
        }
    }
}
