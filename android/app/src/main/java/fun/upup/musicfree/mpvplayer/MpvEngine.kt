package `fun`.upup.musicfree.mpvplayer

import android.content.Context
import dev.jdtech.mpv.MPVLib

/** Raw engine boundary; ownership, scheduling and policy stay in MpvPlayerModule. */
internal interface MpvEngine {
    fun create(context: Context)
    fun init()
    fun destroy()
    fun eventProtocolVersion(): Int
    fun command(command: Array<String>)
    fun loadFile(command: Array<String>): Long
    fun setOptionString(name: String, value: String): Int
    fun getPropertyInt(name: String): Int?
    fun getPropertyDouble(name: String): Double?
    fun getPropertyBoolean(name: String): Boolean?
    fun getPropertyString(name: String): String?
    fun setPropertyInt(name: String, value: Int)
    fun setPropertyDouble(name: String, value: Double)
    fun setPropertyBoolean(name: String, value: Boolean)
    fun setPropertyString(name: String, value: String)
    fun observeProperty(name: String, format: Int)
    fun addObserver(observer: MPVLib.EventObserver)
    fun removeObserver(observer: MPVLib.EventObserver)
}
