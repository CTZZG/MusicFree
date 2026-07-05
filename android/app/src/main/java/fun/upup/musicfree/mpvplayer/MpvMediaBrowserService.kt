package `fun`.upup.musicfree.mpvplayer

import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.utils.MediaConstants

/**
 * Minimal Android Auto / media-browser surface for the mpv backend.
 *
 * Nitro exposes full Android Auto media-library APIs. MPV's queue truth lives in
 * JS, so this service intentionally exposes only the currently loaded playback
 * queue and routes selected media IDs back through the MPV MediaSession.
 */
class MpvMediaBrowserService : MediaBrowserServiceCompat() {
    companion object {
        private const val ROOT_ID = "mpv_root"
        private const val QUEUE_ID = "mpv_current_queue"

        @Volatile
        private var instance: MpvMediaBrowserService? = null

        fun getInstance(): MpvMediaBrowserService? = instance
    }

    private var tokenPublished = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        publishSessionTokenIfAvailable()
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?,
    ): BrowserRoot {
        publishSessionTokenIfAvailable()
        return BrowserRoot(ROOT_ID, browserRootExtras())
    }

    override fun onLoadChildren(
        parentId: String,
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
    ) {
        publishSessionTokenIfAvailable()
        when (parentId) {
            ROOT_ID -> result.sendResult(rootItems())
            QUEUE_ID -> result.sendResult(queueItems())
            else -> result.sendResult(mutableListOf())
        }
    }

    private fun publishSessionTokenIfAvailable() {
        if (tokenPublished) return
        val token = MpvServiceBridge.service?.mediaSessionTokenOrNull() ?: return
        try {
            sessionToken = token
            tokenPublished = true
        } catch (_: IllegalStateException) {
            tokenPublished = true
        } catch (_: Exception) {
        }
    }

    fun onQueueUpdated() {
        try {
            publishSessionTokenIfAvailable()
            notifyChildrenChanged(ROOT_ID)
            notifyChildrenChanged(QUEUE_ID)
        } catch (_: Exception) {
        }
    }

    fun onPlaybackSessionReady() {
        try {
            publishSessionTokenIfAvailable()
        } catch (_: Exception) {
        }
    }

    private fun browserRootExtras() =
        Bundle().apply {
            putInt(
                MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
            putInt(
                MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
        }

    private fun rootItems(): MutableList<MediaBrowserCompat.MediaItem> {
        val queue = MpvServiceBridge.getQueueSnapshot()
        val description =
            MediaDescriptionCompat.Builder()
                .setMediaId(QUEUE_ID)
                .setTitle("当前播放队列")
                .setSubtitle("${queue.size} 首歌曲")
                .setExtras(browserRootExtras())
                .build()

        return mutableListOf(
            MediaBrowserCompat.MediaItem(
                description,
                MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
            ),
        )
    }

    private fun queueItems(): MutableList<MediaBrowserCompat.MediaItem> =
        MpvServiceBridge.getQueueSnapshot()
            .map { track ->
                val description =
                    MediaDescriptionCompat.Builder()
                        .setMediaId(track.id)
                        .setTitle(track.title)
                        .setSubtitle(track.artist)
                        .setDescription(track.album)
                        .setIconUri(parseUriOrNull(track.artwork))
                        .setExtras(playableExtras())
                        .build()
                MediaBrowserCompat.MediaItem(
                    description,
                    MediaBrowserCompat.MediaItem.FLAG_PLAYABLE,
                )
            }
            .toMutableList()

    private fun playableExtras() =
        Bundle().apply {
            putInt(
                MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
        }

    private fun parseUriOrNull(value: String?): Uri? =
        try {
            value?.takeIf { it.isNotBlank() }?.let { Uri.parse(it) }
        } catch (_: Exception) {
            null
        }
}
