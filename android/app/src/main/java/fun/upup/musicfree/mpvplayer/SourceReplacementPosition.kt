package `fun`.upup.musicfree.mpvplayer

/** Stop the same media before reading: bridge/looper waiting must not age the restore target. */
internal object SourceReplacementPosition {
    fun capture(
        fallback: Double,
        sameMedia: Boolean,
        pause: () -> Unit,
        position: () -> Double?,
        pendingPosition: Double? = null,
    ): Double {
        require(fallback.isFinite() && fallback >= 0.0)
        if (!sameMedia) return fallback
        pause()
        // A prior replacement may still be loading at time-pos=0. Its latest
        // deferred seek (including a user seek to zero) is the intended position.
        val stopped = pendingPosition ?: try { position() } catch (_: Exception) { null }
        return stopped?.takeIf { it.isFinite() && it >= 0.0 } ?: fallback
    }
}
