package `fun`.upup.musicfree.mpvplayer

/** Synchronous reads on the caller's thread. The real caller passes JNI getters, never service caches. */
internal object SourceTransitionReader {
    fun read(
        clock: () -> Long,
        path: () -> String?,
        position: () -> Double?,
        idle: () -> Boolean?,
        buffering: () -> Boolean?,
    ): JsFlowProbePolicy.SourceTransitionSample {
        val before = path()
        val raw = position()
        val elapsed = clock()
        val isIdle = idle()
        val isBuffering = buffering()
        val after = path()
        return JsFlowProbePolicy.SourceTransitionSample(
            elapsed, raw, isIdle, isBuffering, if (before == after) after else null,
        )
    }
}
