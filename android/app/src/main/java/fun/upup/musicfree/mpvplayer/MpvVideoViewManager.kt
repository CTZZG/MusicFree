package `fun`.upup.musicfree.mpvplayer

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

internal class MpvVideoViewManager : SimpleViewManager<MpvVideoView>() {
    override fun getName() = "MusicFreeMpvVideo"
    override fun createViewInstance(context: ThemedReactContext) = MpvVideoView(context)
    @ReactProp(name = "mediaId")
    fun setMediaId(view: MpvVideoView, value: String?) { view.mediaId = value.orEmpty() }
    @ReactProp(name = "loadGeneration")
    fun setGeneration(view: MpvVideoView, value: Double) { view.loadGeneration = value.toLong() }
    @ReactProp(name = "outputVisible", defaultBoolean = true)
    fun setVisible(view: MpvVideoView, value: Boolean) { view.outputVisible = value }
    override fun onAfterUpdateTransaction(view: MpvVideoView) { super.onAfterUpdateTransaction(view); view.updateOutput() }
    override fun onDropViewInstance(view: MpvVideoView) { view.dispose(); super.onDropViewInstance(view) }
    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
        mapOf("topVideoFrame" to mapOf("registrationName" to "onVideoFrame"))
}
