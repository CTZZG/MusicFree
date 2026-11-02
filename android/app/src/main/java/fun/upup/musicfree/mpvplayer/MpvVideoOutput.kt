package `fun`.upup.musicfree.mpvplayer

import android.util.Log
import android.view.Surface
import dev.jdtech.mpv.MPVLib

/** Main-looper Surface presentation; playback identity, commands and intent stay in the module. */
internal class MpvVideoOutput(
    private val player: () -> MPVLib?,
    private val accepts: (String, Long) -> Boolean,
    private val canRender: (String, Long) -> Boolean,
    private val onError: () -> Unit,
) {
    private data class Binding(
        val owner: Long,
        val mediaId: String,
        val generation: Long,
        val surface: Surface,
        val width: Int,
        val height: Int,
    )

    private val lease = VideoSurfaceLease()
    private var requested: Binding? = null
    private var attached: Binding? = null
    val isAttached: Boolean get() = attached != null
    val owner: Long? get() = attached?.owner

    fun update(owner: Long, mediaId: String, generation: Long, surface: Surface, width: Int, height: Int) {
        if (!accepts(mediaId, generation) || !lease.claim(owner, generation)) return
        requested = Binding(owner, mediaId, generation, surface, width, height)
        refresh()
    }

    fun release(owner: Long) {
        if (!lease.release(owner)) return
        requested = null
        detach()
    }

    fun owns(owner: Long, mediaId: String, generation: Long): Boolean =
        attached?.let {
            it.owner == owner && it.mediaId == mediaId && it.generation == generation &&
                canRender(mediaId, generation)
        } == true

    fun detach() {
        val bound = attached ?: return
        val mpv = player() ?: return
        mpv.setPropertyString("vid", "no")
        mpv.setPropertyString("vo", "null")
        mpv.detachSurface()
        attached = null
        log(false, bound, mpv)
    }

    fun clear() {
        try {
            detach()
        } catch (error: Exception) {
            Log.w(TAG, "surface cleanup failed", error)
        } finally {
            requested = null
            attached = null
        }
    }

    fun refresh() {
        val bound = requested ?: return
        val mpv = player() ?: return
        if (!canRender(bound.mediaId, bound.generation) || !bound.surface.isValid) return
        try {
            if (attached?.surface !== bound.surface) {
                detach()
                mpv.attachSurface(bound.surface)
                attached = bound
                mpv.setPropertyString("vo", "gpu-next")
                mpv.setPropertyString("vid", "auto")
                log(true, bound, mpv)
            }
            if (bound.width > 0 && bound.height > 0) {
                mpv.setPropertyString("android-surface-size", "${bound.width}x${bound.height}")
            }
        } catch (error: Exception) {
            Log.w(TAG, "video output unavailable", error)
            onError()
        }
    }

    private fun log(attached: Boolean, binding: Binding, mpv: MPVLib) {
        Log.i(TAG, "attached=$attached owner=${binding.owner} generation=${binding.generation} instance=${System.identityHashCode(mpv)}")
    }

    companion object { private const val TAG = "MpvVideoOutput" }
}
