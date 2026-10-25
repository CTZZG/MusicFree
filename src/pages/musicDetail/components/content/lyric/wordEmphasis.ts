/** Duration changes the emphasis, never the lyric clock. Pseudo word timings stay unaccented. */
export function getWordEmphasis(durationMs: number, enabled: boolean) {
    const strength =
        enabled && Number.isFinite(durationMs)
            ? Math.min(1, Math.max(0, (durationMs - 800) / 1600))
            : 0;
    return { lift: 1 + strength * 0.2, scale: strength * 0.025, glow: strength * 6 };
}
