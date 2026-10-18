package `fun`.upup.musicfree.mpvplayer

/** Test-only polling: return the exact snapshot that satisfied readiness. */
internal object AwaitedSnapshot {
    fun <T : Any> capture(
        timeoutMs: Long,
        elapsedMs: () -> Long,
        delay: () -> Unit,
        sample: () -> T,
        ready: (T) -> Boolean,
    ): T {
        val deadline = elapsedMs() + timeoutMs
        while (true) {
            val snapshot = sample()
            if (ready(snapshot)) return snapshot
            if (elapsedMs() >= deadline) {
                throw AssertionError("snapshot readiness timed out; last=$snapshot")
            }
            delay()
        }
    }
}
