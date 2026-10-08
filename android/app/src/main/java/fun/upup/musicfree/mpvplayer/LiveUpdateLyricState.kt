package `fun`.upup.musicfree.mpvplayer

/**
 * Live Update 歌词的两样状态：用户开没开（[enabled]），当前这句歌词（[lyric]）。
 *
 * 两者要分开记。以前当前这句一变空（前奏、间奏的空行、换歌、没有歌词的歌）就当作
 * 关掉了 Live Update，播放通知从进度样式（Live Update）换回媒体样式，下一句来了
 * 再换回去。同一条通知在两种样式之间来回切，荣耀的实况卡片会留着媒体卡片的高度，
 * 按钮那块一片空白。现在只有用户关掉开关才换回媒体样式；没有歌词时标题显示歌名。
 *
 * JS 只在开着 Live Update 歌词时发来歌词，所以收到非空的一句也说明是开着的
 * （应用刚启动、开关还没同步过来时靠这一点）。
 */
internal class LiveUpdateLyricState {
    @Volatile
    var enabled: Boolean = false
        private set

    @Volatile
    var lyric: String = ""
        private set

    /** 用户开关变了。返回 true 表示通知要按新状态重发。 */
    fun setEnabled(value: Boolean): Boolean {
        if (enabled == value) return false
        enabled = value
        if (!value) lyric = ""
        return true
    }

    /**
     * JS 发来当前这句；空的或 null 表示这会儿没有歌词，开关不变。
     * 返回 true 表示通知要重发（开关或这句变了）。
     */
    fun setLyric(text: String?): Boolean {
        val next = text?.trim().orEmpty()
        val enabling = next.isNotEmpty() && !enabled
        if (enabling) enabled = true
        if (!enabling && next == lyric) return false
        lyric = next
        return true
    }

    /** 换歌、播放会话重建：上一首的这句作废，开关是用户设置，保持不变。 */
    fun clearLyric() {
        lyric = ""
    }
}
