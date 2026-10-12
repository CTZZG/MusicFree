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
