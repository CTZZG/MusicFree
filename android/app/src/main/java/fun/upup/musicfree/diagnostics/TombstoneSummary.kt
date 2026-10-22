package `fun`.upup.musicfree.diagnostics

import java.util.Locale

/**
 * 原生崩溃的要点：信号、abort 消息、原因，以及崩溃线程的调用栈。
 *
 * Android 12 起 ApplicationExitInfo 给出的原生崩溃记录是 tombstone protobuf
 * （AOSP system/core/debuggerd/proto/tombstone.proto）。这里只按字段号读需要的几项，
 * 不引入 protobuf 运行库；遇到读不懂的数据返回 null，不抛异常。
 */
internal data class NativeCrashSummary(
    val signal: String?,
    val signalCode: String?,
    val faultAddress: Long?,
    val abortMessage: String?,
    val causes: List<String>,
    val threadName: String?,
    val frames: List<String>,
)

internal object TombstoneSummary {
    // Tombstone
    private const val TID = 6
    private const val SIGNAL_INFO = 10
    private const val ABORT_MESSAGE = 14
    private const val CAUSES = 15
    private const val THREADS = 16

    // Signal
    private const val SIGNAL_NAME = 2
    private const val SIGNAL_CODE_NAME = 4
    private const val SIGNAL_HAS_FAULT_ADDRESS = 8
    private const val SIGNAL_FAULT_ADDRESS = 9

    // Cause
    private const val CAUSE_HUMAN_READABLE = 1

    // map<uint32, Thread> entry, Thread, BacktraceFrame
    private const val MAP_KEY = 1
    private const val MAP_VALUE = 2
    private const val THREAD_NAME = 2
    private const val THREAD_BACKTRACE = 4
    private const val FRAME_REL_PC = 1
    private const val FRAME_FUNCTION_NAME = 4
    private const val FRAME_FUNCTION_OFFSET = 5
    private const val FRAME_FILE_NAME = 6

    fun summarize(bytes: ByteArray, maxFrames: Int = 24): NativeCrashSummary? = try {
        val tombstone = ProtoMessage.parse(bytes)
        val tid = tombstone.varint(TID)
        val signal = tombstone.message(SIGNAL_INFO)
        val crashingThread = tombstone.messages(THREADS)
            .firstOrNull { it.varint(MAP_KEY) == tid }
            ?.message(MAP_VALUE)
        val frames = crashingThread?.messages(THREAD_BACKTRACE).orEmpty()
            .take(maxFrames)
            .mapIndexed { index, frame -> formatFrame(index, frame) }
        NativeCrashSummary(
            signal = signal?.string(SIGNAL_NAME),
            signalCode = signal?.string(SIGNAL_CODE_NAME),
            faultAddress = signal?.takeIf { it.varint(SIGNAL_HAS_FAULT_ADDRESS) == 1L }
                ?.varint(SIGNAL_FAULT_ADDRESS),
            abortMessage = tombstone.string(ABORT_MESSAGE)?.take(1_000),
            causes = tombstone.messages(CAUSES).mapNotNull { it.string(CAUSE_HUMAN_READABLE) }.take(5),
            threadName = crashingThread?.string(THREAD_NAME),
            frames = frames,
        ).takeIf { it.signal != null || it.abortMessage != null || it.frames.isNotEmpty() }
    } catch (_: Exception) {
        null
    }

    /** 与 logcat 里的 tombstone 一样：#00 pc 0001a2b3  libfoo.so (function+12) */
    private fun formatFrame(index: Int, frame: ProtoMessage): String {
        val relPc = frame.varint(FRAME_REL_PC) ?: 0L
        val file = frame.string(FRAME_FILE_NAME) ?: "<unknown>"
        val function = frame.string(FRAME_FUNCTION_NAME)
        val offset = frame.varint(FRAME_FUNCTION_OFFSET) ?: 0L
        val symbol = if (function.isNullOrEmpty()) "" else " ($function+$offset)"
        return String.format(Locale.ROOT, "#%02d pc %08x  %s%s", index, relPc, file, symbol)
    }
}

/** 一层 protobuf 消息：字段号 → 原始值（varint 为 Long，长度定界为 ByteArray）。 */
internal class ProtoMessage private constructor(private val fields: Map<Int, List<Any>>) {
    fun varint(number: Int): Long? = fields[number]?.lastOrNull() as? Long

    fun string(number: Int): String? = (fields[number]?.lastOrNull() as? ByteArray)?.toString(Charsets.UTF_8)

    fun message(number: Int): ProtoMessage? = (fields[number]?.lastOrNull() as? ByteArray)?.let(::parse)

    fun messages(number: Int): List<ProtoMessage> =
        fields[number].orEmpty().filterIsInstance<ByteArray>().mapNotNull {
            try {
                parse(it)
            } catch (_: Exception) {
                null
            }
        }

    companion object {
        fun parse(bytes: ByteArray): ProtoMessage {
            val fields = HashMap<Int, MutableList<Any>>()
            var position = 0
            fun readVarint(): Long {
                var result = 0L
                var shift = 0
                while (true) {
                    require(position < bytes.size && shift < 64) { "truncated varint" }
                    val b = bytes[position++].toInt() and 0xff
                    result = result or ((b and 0x7f).toLong() shl shift)
                    if (b < 0x80) return result
                    shift += 7
                }
            }
            while (position < bytes.size) {
                val key = readVarint()
                val number = (key ushr 3).toInt()
                when ((key and 7).toInt()) {
                    0 -> fields.getOrPut(number) { mutableListOf() }.add(readVarint())
                    1 -> position = skip(position, 8, bytes.size)
                    2 -> {
                        val length = readVarint()
                        require(length >= 0 && length <= bytes.size - position) { "truncated field" }
                        val end = position + length.toInt()
                        fields.getOrPut(number) { mutableListOf() }.add(bytes.copyOfRange(position, end))
                        position = end
                    }
                    5 -> position = skip(position, 4, bytes.size)
                    else -> throw IllegalArgumentException("unsupported wire type")
                }
            }
            return ProtoMessage(fields)
        }

        private fun skip(position: Int, count: Int, size: Int): Int {
            require(position + count <= size) { "truncated fixed field" }
            return position + count
        }
    }
}
