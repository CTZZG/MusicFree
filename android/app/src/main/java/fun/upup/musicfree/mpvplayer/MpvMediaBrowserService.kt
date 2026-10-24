package `fun`.upup.musicfree.mpvplayer

import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.MediaSessionManager
import androidx.media.utils.MediaConstants

/**
 * Minimal Android Auto / media-browser surface for the mpv backend.
 *
 * Nitro exposes full Android Auto media-library APIs. MPV's queue truth lives in
 * JS, so this service intentionally exposes only the currently loaded playback
 * queue and routes selected media IDs back through the MPV MediaSession.
 *
 * “我喜欢”“最近播放”在 JS 里：车机打开时先挂起这次请求，向 JS 要（[MpvServiceBridge.onBrowseRequest]），
 * JS 给回来（[deliverLibraryChildren]）或 5 秒没回音时答复。JS 没起来时直接给空列表。
 * 点了其中一首，媒体 ID 带着 library/ 前缀经 MediaSession 回到 JS，用整个列表替换播放队列再播。
 */
class MpvMediaBrowserService : MediaBrowserServiceCompat() {
    companion object {
        private const val ROOT_ID = "mpv_root"
        private const val QUEUE_ID = "mpv_current_queue"
        private const val LIBRARY_PREFIX = "library/"
        private const val LIBRARY_TIMEOUT_MS = 5_000L
        private val LIBRARY_LISTS = listOf(
            "${LIBRARY_PREFIX}favorite" to "我喜欢",
            "${LIBRARY_PREFIX}recent" to "最近播放",
        )

        @Volatile
        private var instance: MpvMediaBrowserService? = null

        fun getInstance(): MpvMediaBrowserService? = instance
    }

    private var tokenPublished = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingLibrary =
        PendingBrowseRequests<Result<MutableList<MediaBrowserCompat.MediaItem>>>()
    private val libraryTimeouts = HashMap<String, Runnable>()

    override fun onCreate() {
        super.onCreate()
        instance = this
        publishSessionTokenIfAvailable()
    }

    override fun onDestroy() {
        instance = null
        mainHandler.removeCallbacksAndMessages(null)
        libraryTimeouts.clear()
        pendingLibrary.takeAll().forEach { sendQuietly(it, mutableListOf()) }
        super.onDestroy()
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?,
    ): BrowserRoot? {
        val packageBelongsToUid = packageManager
            .getPackagesForUid(clientUid)
            ?.contains(clientPackageName) == true
        val remoteUser = MediaSessionManager.RemoteUserInfo(
            clientPackageName,
            -1,
            clientUid,
        )
        if (
            !packageBelongsToUid ||
            !MediaSessionManager.getSessionManager(this)
                .isTrustedForMediaControl(remoteUser)
        ) {
            return null
        }
        publishSessionTokenIfAvailable()
        return BrowserRoot(ROOT_ID, browserRootExtras())
    }

    override fun onLoadChildren(
        parentId: String,
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
    ) {
        publishSessionTokenIfAvailable()
        when {
            parentId == ROOT_ID -> result.sendResult(rootItems())
            parentId == QUEUE_ID -> result.sendResult(queueItems())
            LIBRARY_LISTS.any { it.first == parentId } -> loadLibrary(parentId, result)
            else -> result.sendResult(mutableListOf())
        }
    }

    private fun loadLibrary(
        parentId: String,
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
    ) {
        val request = MpvServiceBridge.onBrowseRequest
        if (request == null) {
            result.sendResult(mutableListOf())
            return
        }
        result.detach()
        val requestId = pendingLibrary.add(parentId, result) ?: return
        val timeout = Runnable { answerLibrary(parentId, requestId, emptyList()) }
        libraryTimeouts[parentId] = timeout
        mainHandler.postDelayed(timeout, LIBRARY_TIMEOUT_MS)
        request(parentId, requestId)
    }

    /** JS 给回来的列表内容；可以在任何线程调用 */
    fun deliverLibraryChildren(parentId: String, requestId: String, tracks: List<MpvQueueTrack>) {
        mainHandler.post { answerLibrary(parentId, requestId, tracks) }
    }

    private fun answerLibrary(parentId: String, requestId: String, tracks: List<MpvQueueTrack>) {
        val waiting = pendingLibrary.take(parentId, requestId)
        if (waiting.isEmpty()) return
        libraryTimeouts.remove(parentId)?.let { mainHandler.removeCallbacks(it) }
        waiting.forEach { sendQuietly(it, playableItems(tracks)) }
    }

    private fun sendQuietly(
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
        items: MutableList<MediaBrowserCompat.MediaItem>,
    ) {
        try {
            result.sendResult(items)
        } catch (_: IllegalStateException) {
            // 车机已经不要这个结果了
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

        val libraries = LIBRARY_LISTS.map { (id, title) ->
            MediaBrowserCompat.MediaItem(
                MediaDescriptionCompat.Builder()
                    .setMediaId(id)
                    .setTitle(title)
                    .setExtras(browserRootExtras())
                    .build(),
                MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
            )
        }

        return (
            listOf(
                MediaBrowserCompat.MediaItem(
                    description,
                    MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
                ),
            ) + libraries
            ).toMutableList()
    }

    private fun queueItems(): MutableList<MediaBrowserCompat.MediaItem> =
        playableItems(MpvServiceBridge.getQueueSnapshot())

    private fun playableItems(tracks: List<MpvQueueTrack>): MutableList<MediaBrowserCompat.MediaItem> =
        tracks
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
