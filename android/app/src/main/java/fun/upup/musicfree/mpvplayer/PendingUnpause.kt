package `fun`.upup.musicfree.mpvplayer

/**
 * 装载、恢复播放之后还要不要替 mpv 取消暂停。
 *
 * mpv 装载新文件或恢复播放后有时停在暂停不出声，所以会在 0/80/250/700ms 各重试
 * 一次取消暂停，FILE_LOADED、PLAYBACK_RESTART（跳转后也会发）时也会再取消一次。
 * 这些只在“这一代还要自动播放”时才做：明确暂停之后就撤销，排在后面的重试、之后
 * 跳转引起的 PLAYBACK_RESTART 都不能再把它放出来。以前暂停不撤销，装载或恢复后
 * 0.7 秒内暂停，会被迟到的重试重新播放；暂停后跳转也会自己开始播。
 *
 * 只在主线程调用。
 */
internal class PendingUnpause {
    private var generation = NONE

    /** 第 [generation] 代文件要自动播放。 */
    fun arm(generation: Long) {
        this.generation = generation
    }

    /** 不再自动播放：明确暂停、停止、装载时不自动播、播放结束。 */
    fun cancel() {
        generation = NONE
    }

    fun isArmedFor(generation: Long): Boolean =
        generation != NONE && this.generation == generation

    private companion object {
        const val NONE = -1L
    }
}
