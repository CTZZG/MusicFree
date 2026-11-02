package `fun`.upup.musicfree.mpvplayer

import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.util.concurrent.atomic.AtomicLong

/** TextureView participates in RN clipping, transforms and overlays; it never owns a player. */
internal class MpvVideoView(private val reactContext: ThemedReactContext) :
    TextureView(reactContext), TextureView.SurfaceTextureListener {
    private val surfaceOwner = nextOwner.incrementAndGet()
    private var output: Surface? = null
    private var outputTexture: SurfaceTexture? = null
    var mediaId: String = ""
    var loadGeneration: Long = -1L
    var outputVisible = true
    private var notifiedGeneration = -1L

    init {
        isOpaque = false
        surfaceTextureListener = this
    }

    fun updateOutput() {
        val module = reactContext.getNativeModule(MpvPlayerModule::class.java) ?: return
        if (!outputVisible || !isAttachedToWindow || windowVisibility != View.VISIBLE) {
            module.releaseVideoSurface(surfaceOwner)
        } else {
            output?.takeIf { it.isValid }?.let {
                module.updateVideoSurface(surfaceOwner, mediaId, loadGeneration, it, width, height)
            }
        }
    }

    fun dispose() {
        reactContext.getNativeModule(MpvPlayerModule::class.java)?.releaseVideoSurface(surfaceOwner)
        output?.release()
        output = null
        outputTexture = null
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); updateOutput() }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (isAttachedToWindow) updateOutput()
    }
    override fun onDetachedFromWindow() {
        reactContext.getNativeModule(MpvPlayerModule::class.java)?.releaseVideoSurface(surfaceOwner)
        super.onDetachedFromWindow()
    }
    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        dispose()
        outputTexture = texture
        output = Surface(texture)
        notifiedGeneration = -1L
        updateOutput()
    }
    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        if (texture === outputTexture) updateOutput()
    }
    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        if (texture === outputTexture) dispose()
        return true
    }
    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {
        if (texture !== outputTexture) return
        if (notifiedGeneration == loadGeneration) return
        val module = reactContext.getNativeModule(MpvPlayerModule::class.java) ?: return
        if (!module.ownsVideoSurface(surfaceOwner, mediaId, loadGeneration)) return
        notifiedGeneration = loadGeneration
        UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(
            VideoFrameEvent(UIManagerHelper.getSurfaceId(this), id, mediaId, loadGeneration),
        )
    }

    companion object { private val nextOwner = AtomicLong() }
}

private class VideoFrameEvent(surfaceId: Int, viewId: Int, private val mediaId: String, private val generation: Long) :
    Event<VideoFrameEvent>(surfaceId, viewId) {
    override fun getEventName() = "topVideoFrame"
    override fun canCoalesce() = false
    override fun getEventData() = Arguments.createMap().apply {
        putString("mediaId", mediaId)
        putDouble("loadGeneration", generation.toDouble())
    }
}
