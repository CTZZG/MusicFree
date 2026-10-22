package `fun`.upup.musicfree.mpvplayer

import android.media.AudioDeviceInfo

/**
 * 车载蓝牙歌词：车机和蓝牙设备的屏幕只显示媒体会话里的歌名、歌手（蓝牙 AVRCP、Android Auto
 * 都读这两项），把当前这句歌词放进歌名的位置，车上就能看到。
 *
 * 只在连着蓝牙音频输出或 Android Auto 时生效，和“媒体通知歌词”“Live Update 歌词”互不影响。
 * 媒体会话只有一个，生效期间手机上的系统媒体卡片也会显示歌词。
 */
internal class CarLyricState {
    @Volatile
    var enabled = false
        private set

    @Volatile
    var lyric = ""
        private set

    @Volatile
    var bluetoothOutput = false
        private set

    /** 返回值：开关有没有变 */
    fun setEnabled(value: Boolean): Boolean {
        if (enabled == value) return false
        enabled = value
        if (!value) lyric = ""
        return true
    }

    /** 返回值：这一句有没有变；空的或 null 表示这会儿没有歌词（前奏、间奏、换歌） */
    fun setLyric(value: String?): Boolean {
        val next = value?.trim().orEmpty()
        if (lyric == next) return false
        lyric = next
        return true
    }

    fun clearLyric(): Boolean = setLyric(null)

    /** 返回值：有没有变 */
    fun setBluetoothOutput(value: Boolean): Boolean {
        if (bluetoothOutput == value) return false
        bluetoothOutput = value
        return true
    }

    /** 媒体会话里要显示的这一句；不该显示时是空的，歌名照常 */
    fun displayedLyric(androidAutoConnected: Boolean): String =
        if (enabled && (bluetoothOutput || androidAutoConnected)) lyric else ""

    companion object {
        /** 车机常见的蓝牙音频输出：经典蓝牙 A2DP，和 LE Audio 的音箱、耳机 */
        private val BLUETOOTH_MEDIA_OUTPUTS = setOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
        )

        fun isBluetoothMediaOutput(deviceTypes: Collection<Int>): Boolean =
            deviceTypes.any { it in BLUETOOTH_MEDIA_OUTPUTS }
    }
}
