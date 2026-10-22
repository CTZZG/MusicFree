package `fun`.upup.musicfree.diagnostics

import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TombstoneSummaryTest {
    /** 按 tombstone.proto 的字段号拼一条测试用的 protobuf。 */
    private class Proto {
        private val out = ByteArrayOutputStream()

        private fun varintBytes(value: Long) {
            var v = value
            while (v and 0x7fL.inv() != 0L) {
                out.write(((v and 0x7f) or 0x80).toInt())
                v = v ushr 7
            }
            out.write(v.toInt())
        }

        fun varint(number: Int, value: Long) = apply {
            varintBytes((number.toLong() shl 3) or 0)
            varintBytes(value)
        }

        fun bytes(number: Int, value: ByteArray) = apply {
            varintBytes((number.toLong() shl 3) or 2)
            varintBytes(value.size.toLong())
            out.write(value)
        }

        fun string(number: Int, value: String) = bytes(number, value.toByteArray())

        fun message(number: Int, value: Proto) = bytes(number, value.build())

        fun fixed64(number: Int) = apply {
            varintBytes((number.toLong() shl 3) or 1)
            out.write(ByteArray(8))
        }

        fun fixed32(number: Int) = apply {
            varintBytes((number.toLong() shl 3) or 5)
            out.write(ByteArray(4))
        }

        fun build(): ByteArray = out.toByteArray()
    }

    private fun frame(relPc: Long, file: String, function: String? = null, offset: Long = 0) = Proto()
        .varint(1, relPc)
        .varint(2, relPc + 0x7000_0000L)
        .apply { if (function != null) string(4, function).varint(5, offset) }
        .string(6, file)

    private fun thread(name: String, vararg frames: Proto) = Proto()
        .varint(1, 1)
        .string(2, name)
        .apply { frames.forEach { message(4, it) } }

    private fun tombstone() = Proto()
        .varint(1, 1) // arch = ARM64
        .string(2, "fingerprint")
        .varint(5, 4000) // pid
        .varint(6, 4321) // tid of the crashing thread
        .message(10, Proto()
            .varint(1, 11)
            .string(2, "SIGSEGV")
            .varint(3, 2)
            .string(4, "SEGV_ACCERR")
            .varint(8, 1)
            .varint(9, 0xdeadL))
        .message(15, Proto().string(1, "trying to execute non-executable memory"))
        .message(16, Proto().varint(1, 1).message(2, thread("main", frame(0x10, "libc.so"))))
        .message(16, Proto().varint(1, 4321).message(2, thread(
            "mqt_v_js",
            frame(0x1a2b, "/data/app/lib/arm64/libreactnative.so", "MountingCoordinator::pullTransaction", 713),
            frame(0x44, "/apex/libc.so"),
        )))
        .varint(22, 16384) // page_size, not read
        .fixed64(99) // fields the parser does not know are skipped
        .fixed32(98)

    @Test
    fun theCrashingThreadAndSignalAreExtracted() {
        val summary = TombstoneSummary.summarize(tombstone().build())!!

        assertEquals("SIGSEGV", summary.signal)
        assertEquals("SEGV_ACCERR", summary.signalCode)
        assertEquals(0xdeadL, summary.faultAddress)
        assertEquals(listOf("trying to execute non-executable memory"), summary.causes)
        assertEquals("mqt_v_js", summary.threadName)
        assertEquals(
            listOf(
                "#00 pc 00001a2b  /data/app/lib/arm64/libreactnative.so (MountingCoordinator::pullTransaction+713)",
                "#01 pc 00000044  /apex/libc.so",
            ),
            summary.frames,
        )
        assertNull(summary.abortMessage)
    }

    @Test
    fun anAbortWithoutFramesIsStillReported() {
        val bytes = Proto()
            .varint(6, 9)
            .message(10, Proto().string(2, "SIGABRT"))
            .string(14, "Check failed: queue != null")
            .build()

        val summary = TombstoneSummary.summarize(bytes)!!
        assertEquals("SIGABRT", summary.signal)
        assertEquals("Check failed: queue != null", summary.abortMessage)
        assertNull(summary.faultAddress)
        assertEquals(emptyList<String>(), summary.frames)
    }

    @Test
    fun framesAreCapped() {
        val frames = (0 until 40).map { frame(it.toLong(), "lib$it.so") }.toTypedArray()
        val bytes = Proto()
            .varint(6, 5)
            .message(10, Proto().string(2, "SIGSEGV"))
            .message(16, Proto().varint(1, 5).message(2, thread("worker", *frames)))
            .build()

        assertEquals(24, TombstoneSummary.summarize(bytes)!!.frames.size)
        assertEquals(3, TombstoneSummary.summarize(bytes, maxFrames = 3)!!.frames.size)
    }

    @Test
    fun malformedOrEmptyDataGivesNoSummaryInsteadOfThrowing() {
        val bytes = tombstone().build()
        assertNull(TombstoneSummary.summarize(bytes.copyOf(bytes.size / 2)))
        assertNull(TombstoneSummary.summarize(ByteArray(0)))
        assertNull(TombstoneSummary.summarize(byteArrayOf(0x0f, 0x01))) // wire type 7 does not exist
    }
}
