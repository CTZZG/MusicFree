package `fun`.upup.musicfree.mpvplayer

import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.util.concurrent.atomic.AtomicLong

/** TextureView participates in RN clipping, transforms and overlays; it never owns a player. */
internal class MpvVideoView(private val reactContext: ThemedReactContext) :
    TextureView(reactContext), TextureView.SurfaceTextureListener, LifecycleEventListener {
    private val surfaceOwner = nextOwner.incrementAndGet()
    private var output: Surface? = null
    private var outputTexture: SurfaceTexture? = null
    var mediaId: String = ""
    var loadGeneration: Long = -1L
    var outputVisible = true
    private var notifiedGeneration = -1L
    private var lifecycleBound = false

    init {
        isOpaque = false
        surfaceTextureListener = this
    }

    fun updateOutput() {
        val module = reactContext.getNativeModule(MpvPlayerModule::class.java) ?: return
        // Read the App context, not the themed wrapper's stale lifecycle snapshot.
        // A queued resume notification must not override a subsequent real pause.
        val resumed = reactContext.reactApplicationContext.lifecycleState == LifecycleState.RESUMED
        if (!lifecycleBound || !resumed || !outputVisible || !isAttachedToWindow || windowVisibility != View.VISIBLE) {
            module.releaseVideoSurface(surfaceOwner)
        } else {
            output?.takeIf { it.isValid }?.let {
                module.updateVideoSurface(surfaceOwner, mediaId, loadGeneration, it, width, height)
            }
        }
    }

    fun dispose() {
        unbindLifecycle()
        releaseOutput()
    }

    private fun releaseOutput() {
        reactContext.getNativeModule(MpvPlayerModule::class.java)?.releaseVideoSurface(surfaceOwner)
        output?.release()
        output = null
        outputTexture = null
    }

    private fun bindLifecycle() {
        if (lifecycleBound) return
        lifecycleBound = true
        reactContext.addLifecycleEventListener(this)
    }

    private fun unbindLifecycle() {
        if (!lifecycleBound) return
        lifecycleBound = false
        reactContext.removeLifecycleEventListener(this)
    }

    override fun onHostPause() { updateOutput() }
    override fun onHostResume() { updateOutput() }
    override fun onHostDestroy() { dispose() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); bindLifecycle(); updateOutput() }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (isAttachedToWindow) updateOutput()
    }
    override fun onDetachedFromWindow() {
        unbindLifecycle()
        reactContext.getNativeModule(MpvPlayerModule::class.java)?.releaseVideoSurface(surfaceOwner)
        super.onDetachedFromWindow()
    }
    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        releaseOutput()
        outputTexture = texture
        output = Surface(texture)
        notifiedGeneration = -1L
        if (isAttachedToWindow) bindLifecycle()
        updateOutput()
    }
    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        if (texture === outputTexture) updateOutput()
    }
    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        if (texture === outputTexture) releaseOutput()
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
