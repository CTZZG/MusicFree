package `fun`.upup.musicfree.lyricUtil

import org.junit.Assert.*
import org.junit.Test

class LyricUiTaskRunnerTest {
    @Test fun aQueuedSuccessSettlesAfterTheOperationNotAfterPosting() {
        val queue = mutableListOf<Runnable>()
        val calls = mutableListOf<String>()
        LyricUiTaskRunner { queue.add(it) }.run(
            { calls.add("operation") }, { calls.add("resolve") }, { calls.add("reject") },
        )
        assertTrue(calls.isEmpty())
        queue.single().run()
        assertEquals(listOf("operation", "resolve"), calls)
    }

    @Test fun anExceptionInsideThePostedOperationRejectsWithoutEscapingTheUiTask() {
        val queue = mutableListOf<Runnable>()
        val expected = IllegalArgumentException("View not attached to window manager")
        val errors = mutableListOf<Exception>()
        var resolved = 0
        LyricUiTaskRunner { queue.add(it) }.run({ throw expected }, { resolved++ }, { errors.add(it) })
        assertEquals(0, resolved)
        assertTrue(errors.isEmpty())
        queue.single().run()
        assertEquals(0, resolved)
        assertEquals(listOf(expected), errors)
    }

    @Test fun aRejectedOperationDoesNotPreventTheNextUiTaskFromRunning() {
        val queue = mutableListOf<Runnable>()
        val calls = mutableListOf<String>()
        val runner = LyricUiTaskRunner { queue.add(it) }
        runner.run({ error("first operation failed") }, { calls.add("wrong resolve") }, { calls.add("reject") })
        runner.run({ calls.add("next operation") }, { calls.add("next resolve") }, { calls.add("wrong reject") })
        queue.forEach { it.run() }
        assertEquals(listOf("reject", "next operation", "next resolve"), calls)
    }

    @Test fun aDispatchFailureRejectsInsteadOfReportingSuccess() {
        val expected = IllegalStateException("dispatcher unavailable")
        val errors = mutableListOf<Exception>()
        var called = false
        LyricUiTaskRunner { throw expected }.run({ called = true }, { fail("resolved") }, { errors.add(it) })
        assertFalse(called)
        assertEquals(listOf(expected), errors)
    }

    @Test fun anInlineUiExecutionAlsoRejectsOnlyOnce() {
        var rejected = 0
        LyricUiTaskRunner { it.run() }.run({ error("inline failure") }, { fail("resolved") }, { rejected++ })
        assertEquals(1, rejected)
    }

    @Test fun aResolveBridgeFailureIsAlsoCaughtInsideThePostedTask() {
        val queue = mutableListOf<Runnable>()
        val expected = IllegalStateException("bridge unavailable")
        val errors = mutableListOf<Exception>()
        LyricUiTaskRunner { queue.add(it) }.run({}, { throw expected }, { errors.add(it) })
        queue.single().run()
        assertEquals(listOf(expected), errors)
    }
}
