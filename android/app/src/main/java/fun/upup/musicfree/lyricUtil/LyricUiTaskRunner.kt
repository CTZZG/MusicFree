package `fun`.upup.musicfree.lyricUtil

/** Settle only after the UI operation runs; dispatch errors and UI errors share the rejection path. */
internal class LyricUiTaskRunner(private val post: (Runnable) -> Unit) {
    fun run(action: () -> Unit, resolve: () -> Unit, reject: (Exception) -> Unit) {
        try {
            post(Runnable {
                try {
                    action()
                    resolve()
                } catch (error: Exception) {
                    reject(error)
                }
            })
        } catch (error: Exception) {
            reject(error)
        }
    }
}
