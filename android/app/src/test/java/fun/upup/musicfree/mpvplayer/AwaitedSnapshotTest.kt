package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class AwaitedSnapshotTest {
    private data class Reading(val state: Int, val position: Double)

    @Test fun returnsTheValidatedSnapshotWithoutReadingAChangedStateAgain() {
        // API87: the engine advances, but the session can return to BUFFERING
        // after a PLAYING observation and before a separate evidence read.
        val buffering = Reading(6, 30.5)
        val playing = Reading(3, 30.6)
        val readings = listOf(buffering, playing, buffering)
        var samples = 0
        var now = 0L
        val accepted = AwaitedSnapshot.capture(
            timeoutMs = 100,
            elapsedMs = { now },
            delay = { now += 50 },
            sample = { readings[samples++] },
            ready = { it.state == 3 && it.position > 30.25 },
        )
        assertSame(playing, accepted)
        assertEquals(2, samples)
        assertEquals(50L, now)
    }

    @Test fun advancingPositionWithoutPlayingStillFailsAtTheDeadline() {
        var samples = 0
        var now = 0L
        assertThrows(AssertionError::class.java) {
            AwaitedSnapshot.capture<Reading>(
                timeoutMs = 100,
                elapsedMs = { now },
                delay = { now += 50 },
                sample = { Reading(6, 30.5 + samples++) },
                ready = { it.state == 3 && it.position > 30.25 },
            )
        }
        assertEquals(3, samples)
        assertEquals(100L, now)
    }
}
