package `fun`.upup.musicfree.mpvplayer

/** mpv can advance on its own between synchronous property calls. */
internal object OwnedMpvClock {
    fun <T : Any> read(owner: T, entryId: () -> Long?, ownerOf: (Long) -> T?, clock: () -> Double?): Double? {
        val before = entryId() ?: return null
        if (ownerOf(before) != owner) return null
        val position = clock()?.takeIf { it.isFinite() && it >= 0.0 } ?: return null
        val after = entryId()
        return position.takeIf { after == before && ownerOf(before) == owner }
    }
}
