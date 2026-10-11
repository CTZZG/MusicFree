package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class EngineProgressProbeTest {
    private fun playing() = (0..4).map { n ->
        EngineProgressSample(n * 1000L, 10.0 + n, false, false, false, "tone.wav", 10000L + n * 1000, 3)
    }

    private fun rejects(code: String, action: () -> Unit) {
        val error = assertThrows(AssertionError::class.java, action)
        assertTrue(error.message, error.message!!.startsWith("$code:"))
    }

    @Test fun acceptsRealProgressAndBoundedProjection() {
        EngineProgressProbe.assertPlaying(playing().map { it.copy(sessionMs = it.sessionMs + 1000) }, "tone.wav")
    }

    @Test fun rejectsProjectedProgressWhenTheEngineIsFrozen() {
        rejects("RAW_STALLED") {
            EngineProgressProbe.assertPlaying(playing().map { it.copy(rawSeconds = 10.0) }, "tone.wav")
        }
    }

    @Test fun rejectsOneStalledIntervalDespiteNetProgress() {
        rejects("RAW_STALLED") {
            EngineProgressProbe.assertPlaying(playing().mapIndexed { n, s -> if (n == 2) s.copy(rawSeconds = 11.0) else s }, "tone.wav")
        }
    }

    @Test fun rejectsMissingAndNonFiniteRawReads() {
        for (position in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0)) {
            rejects("MISSING_ENGINE") { EngineProgressProbe.assertPlaying(playing().map { it.copy(rawSeconds = position) }, "tone.wav") }
        }
    }

    @Test fun rejectsTheWrongTrackAndAnInsufficientWindow() {
        rejects("TRACK") { EngineProgressProbe.assertPlaying(playing(), "other.wav") }
        rejects("WINDOW") { EngineProgressProbe.assertPlaying(playing().take(4), "tone.wav") }
        rejects("WINDOW") { EngineProgressProbe.assertPlaying(playing().map { it.copy(elapsedMs = it.elapsedMs / 2) }, "tone.wav") }
    }

    @Test fun rejectsEngineAndSessionStateMismatch() {
        for (sample in listOf(playing()[2].copy(paused = true), playing()[2].copy(idle = true), playing()[2].copy(buffering = true))) {
            rejects("ENGINE_STATE") { EngineProgressProbe.assertPlaying(playing().toMutableList().apply { this[2] = sample }, "tone.wav") }
        }
        rejects("SESSION_STATE") { EngineProgressProbe.assertPlaying(playing().map { it.copy(sessionState = 2) }, "tone.wav") }
        rejects("PROJECTION_DRIFT") { EngineProgressProbe.assertPlaying(playing().map { it.copy(sessionMs = it.sessionMs + 3000) }, "tone.wav") }
    }

    @Test fun rejectsAStalledSessionEvenWhenTheEngineMoves() {
        rejects("SESSION_STALLED") { EngineProgressProbe.assertPlaying(playing().map { it.copy(sessionMs = 10000) }, "tone.wav") }
    }

    @Test fun rejectsSeekLikeJumpsDuringAnObservationWindow() {
        rejects("RAW_RATE") { EngineProgressProbe.assertPlaying(playing().map { it.copy(rawSeconds = it.rawSeconds!! * 3) }, "tone.wav") }
    }

    @Test fun pausedRequiresBothClocksToStayStill() {
        val paused = playing().map { it.copy(rawSeconds = 10.0, sessionMs = 10000, paused = true, sessionState = 2) }
        EngineProgressProbe.assertPaused(paused, "tone.wav")
        rejects("RAW_MOVED") { EngineProgressProbe.assertPaused(paused.mapIndexed { n, s -> s.copy(rawSeconds = 10.0 + n) }, "tone.wav") }
        rejects("SESSION_MOVED") { EngineProgressProbe.assertPaused(paused.mapIndexed { n, s -> s.copy(sessionMs = 10000L + n * 1000) }, "tone.wav") }
    }
}
