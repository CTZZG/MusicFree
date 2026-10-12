package `fun`.upup.musicfree.mpvplayer

import kotlin.math.abs

/** Test-only oracle. Engine fields must come from JNI, never cached JS/service values. */
internal data class EngineProgressSample(
    val elapsedMs: Long,
    val rawSeconds: Double?,
    val paused: Boolean?,
    val idle: Boolean?,
    val buffering: Boolean?,
    val path: String?,
    val sessionMs: Long,
    val sessionState: Int,
)

internal object EngineProgressProbe {
    fun assertPlaying(samples: List<EngineProgressSample>, expectedPath: String) {
        validateWindow(samples, expectedPath)
        // Inspect real advancement first: a projected MediaSession clock alone cannot pass.
        for ((before, after) in samples.zipWithNext()) {
            val seconds = (after.elapsedMs - before.elapsedMs) / 1000.0
            val advance = after.rawSeconds!! - before.rawSeconds!!
            requireProbe(advance >= seconds * 0.25, "RAW_STALLED", "$advance in ${seconds}s")
            requireProbe(advance <= seconds * 1.75 + 0.25, "RAW_RATE", "$advance in ${seconds}s")
            requireProbe(after.sessionMs - before.sessionMs >= seconds * 250, "SESSION_STALLED", "$before -> $after")
        }
        for (sample in samples) {
            requireProbe(
                sample.paused == false && sample.idle == false && sample.buffering == false,
                "ENGINE_STATE", sample.toString(),
            )
            requireProbe(sample.sessionState == 3, "SESSION_STATE", sample.toString())
            requireProbe(
                abs(sample.sessionMs / 1000.0 - sample.rawSeconds!!) <= 1.5,
                "PROJECTION_DRIFT", sample.toString(),
            )
        }
    }

    fun assertPaused(samples: List<EngineProgressSample>, expectedPath: String) {
        validateWindow(samples, expectedPath)
        val first = samples.first()
        for (sample in samples) {
            requireProbe(sample.paused == true && sample.idle == false, "ENGINE_STATE", sample.toString())
            requireProbe(sample.sessionState == 2, "SESSION_STATE", sample.toString())
            requireProbe(abs(sample.rawSeconds!! - first.rawSeconds!!) <= 0.15, "RAW_MOVED", sample.toString())
            requireProbe(abs(sample.sessionMs - first.sessionMs) <= 250, "SESSION_MOVED", sample.toString())
            requireProbe(abs(sample.sessionMs / 1000.0 - sample.rawSeconds) <= 1.5, "PROJECTION_DRIFT", sample.toString())
        }
    }

    private fun validateWindow(samples: List<EngineProgressSample>, expectedPath: String) {
        requireProbe(samples.size >= 5, "WINDOW", "at least five samples required")
        requireProbe(samples.last().elapsedMs - samples.first().elapsedMs >= 4000, "WINDOW", "at least four seconds required")
        for ((before, after) in samples.zipWithNext()) {
            requireProbe(after.elapsedMs - before.elapsedMs >= 750, "WINDOW", "samples too close or reversed")
            requireProbe(after.elapsedMs - before.elapsedMs <= 5000, "WINDOW", "observation gap too large")
        }
        for (sample in samples) {
            requireProbe(
                sample.rawSeconds != null && sample.rawSeconds.isFinite() && sample.rawSeconds >= 0 &&
                    sample.paused != null && sample.idle != null && sample.buffering != null,
                "MISSING_ENGINE", sample.toString(),
            )
            requireProbe(sample.path == expectedPath && expectedPath.isNotBlank(), "TRACK", sample.toString())
        }
    }

    private fun requireProbe(condition: Boolean, code: String, detail: String) {
        if (!condition) throw AssertionError("$code: $detail")
    }
}
