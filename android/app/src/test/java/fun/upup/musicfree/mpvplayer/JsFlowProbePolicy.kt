package `fun`.upup.musicfree.mpvplayer

/** Test-only checks shared by JVM and the real-JS instrumented test. */
object JsFlowProbePolicy {
    val phases = setOf(
        "baseline", "slow-skip-wait", "slow-skip-playing", "timeout-wait", "timeout-rollback",
        "quality-interrupted-old", "quality-interrupted-new", "quality-focus-resumed",
        "user-pause-old", "user-pause-new", "user-pause-after-focus", "explicit-play",
        "quality-playing-old", "quality-playing-new",
    )

    fun assertComplete(completed: Set<String>) {
        check(completed == phases) { "PHASES: expected $phases, got $completed" }
    }

    fun assertResumeAnchor(anchor: Double, actual: Double) {
        check(anchor.isFinite() && actual.isFinite() && anchor >= 3.0 && actual >= 0.0) { "ANCHOR: invalid positions" }
        check(kotlin.math.abs(actual - anchor) <= 2.0) { "ANCHOR: expected around $anchor, got $actual" }
    }

    fun assertSourceContinuity(oldStop: Double, newStart: Double) {
        check(oldStop.isFinite() && oldStop >= 3.0 && newStart.isFinite() && newStart >= 0.0) {
            "SOURCE_REWIND: invalid positions"
        }
        check(newStart >= oldStop - 0.25) { "SOURCE_REWIND: old source stopped at $oldStop, new started at $newStart" }
    }

    internal data class SourceTransition(
        val old: EngineProgressSample,
        val firstNew: EngineProgressSample,
        val pollGapMs: Long,
        val maxPollGapMs: Long,
    )

    /** Keep the earliest restored read, before readiness waits or settling sleeps. */
    internal class SourceTransitionProbe(private val oldPath: String, private val newPath: String) {
        var result: SourceTransition? = null
            private set
        private var lastOld: EngineProgressSample? = null
        private var previousElapsedMs: Long? = null
        private var maxPollGapMs = 0L

        fun observe(sample: EngineProgressSample): Boolean {
            if (result != null) return true
            val gap = previousElapsedMs?.let { sample.elapsedMs - it }
            check(gap == null || gap >= 0) { "TRANSITION_WINDOW: reversed clock" }
            previousElapsedMs = sample.elapsedMs
            // Keep gaps even for unload/restore polls without a usable position.
            if (lastOld != null && gap != null) maxPollGapMs = maxOf(maxPollGapMs, gap)
            val raw = sample.rawSeconds
            // The scenario is already past 3 seconds. Loading can temporarily
            // show zero before the restore seek; never wait relative to oldStop.
            if (raw == null || !raw.isFinite() || raw < 3.0 || sample.idle != false || sample.buffering != false) return false
            if (sample.path == oldPath) {
                lastOld = sample
                // This fresh old position replaces the earlier anchor; only
                // intervals after this reading belong to the transition.
                maxPollGapMs = 0L
            }
            if (sample.path != newPath) return false
            val old = requireNotNull(lastOld) { "TRANSITION_WINDOW: missing old source" }
            check(gap != null && gap <= 250) { "TRANSITION_WINDOW: first new read followed a $gap ms polling gap" }
            check(maxPollGapMs <= 250) { "TRANSITION_WINDOW: transition included a $maxPollGapMs ms polling gap" }
            result = SourceTransition(old, sample, gap, maxPollGapMs)
            return true
        }
    }

    fun focusOwner(text: String): String? {
        var inStack = false
        var owner: String? = null
        for (line in text.lineSequence()) {
            if (line.contains("Audio Focus stack entries")) {
                inStack = true
                owner = null
            } else if (inStack) {
                val trimmed = line.trim()
                if (trimmed.startsWith("source:") && trimmed.contains("-- pack: ")) {
                    owner = Regex("-- pack: (\\S+)").find(trimmed)?.groupValues?.get(1)
                } else if (owner != null && trimmed.isNotEmpty()) {
                    inStack = false
                }
            }
        }
        return owner
    }
}
