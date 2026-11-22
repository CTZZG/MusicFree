package `fun`.upup.musicfree.mpvplayer

/** Main-looper ownership. A late destroy/update from an older view cannot steal a new surface. */
internal class VideoSurfaceLease {
    private var generation = -1L
    private var newestOwner = -1L
    var owner: Long? = null
        private set

    fun claim(requestOwner: Long, requestGeneration: Long): Boolean {
        if (requestGeneration < generation) return false
        if (requestGeneration != generation) {
            generation = requestGeneration
            newestOwner = -1L
        }
        if (requestOwner < newestOwner) return false
        newestOwner = requestOwner
        owner = requestOwner
        return true
    }

    fun release(requestOwner: Long): Boolean {
        if (owner != requestOwner) return false
        owner = null
        return true
    }
}
