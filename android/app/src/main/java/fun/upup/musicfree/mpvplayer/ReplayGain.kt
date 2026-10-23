package `fun`.upup.musicfree.mpvplayer

/**
 * 音量平衡（ReplayGain）：JS 设置里的 off / track / album 对应 mpv 的 replaygain 选项。
 * 不认识的值按关闭处理，不把任意字符串交给 mpv。见 src/core/playerAdapter/replayGain.ts。
 */
internal object ReplayGain {
    fun mpvValue(mode: String?): String = when (mode) {
        "track" -> "track"
        "album" -> "album"
        else -> "no"
    }
}
