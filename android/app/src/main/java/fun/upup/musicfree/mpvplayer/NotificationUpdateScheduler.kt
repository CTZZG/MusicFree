package `fun`.upup.musicfree.mpvplayer

/**
 * Keep notification bursts below Android's per-package enqueue rate limit.
 * A queued update reads the latest service state when sent, including a final
 * pause after progress has stopped. All calls run on the main looper.
 */
internal class NotificationUpdateScheduler(
    private val now: () -> Long,
    private val post: (Runnable, Long) -> Unit,
    private val cancel: (Runnable) -> Unit,
    private val send: () -> Unit,
) {
    private var lastSentAt: Long? = null
    private var scheduled = false
    private val runnable = Runnable {
        if (scheduled) {
            scheduled = false
            request()
        }
    }

    fun request() {
        if (scheduled) return
        val delay = lastSentAt?.let { 250L - (now() - it).coerceAtLeast(0L) } ?: 0L
        if (delay <= 0L) {
            lastSentAt = now()
            send()
        } else {
            scheduled = true
            post(runnable, delay)
        }
    }

    /** The mandatory first startForeground notification also consumes a slot. */
    fun onForegroundPosted() {
        cancel()
        lastSentAt = now()
    }

    fun cancel() {
        scheduled = false
        cancel(runnable)
    }
}
