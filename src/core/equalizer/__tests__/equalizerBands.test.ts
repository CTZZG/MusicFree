import { readFileSync } from "node:fs";
import path from "node:path";
import {
    EQUALIZER_BANDS,
    EQUALIZER_GAIN,
    EQUALIZER_PRESETS,
    isEqualizerSupported,
} from "../bands";

/**
 * 均衡器此前是「UI 能拖、声音不变」的假功能。接上 Nitro DSP 后，最容易再次
 * 变假的方式是 UI 与原生频段/量程悄悄漂移——滑杆标着 60Hz，实际调的是 31Hz。
 * 这些断言直接对着 Nitro 原生源码校验，而不是对着我们自己的常量。
 */
const nitroEqualizerCore = readFileSync(
    path.join(
        process.cwd(),
        "node_modules/react-native-nitro-player/android/src/main/java",
        "com/margelo/nitro/nitroplayer/equalizer/EqualizerCore.kt",
    ),
    "utf8",
);

function nitroFrequencies() {
    const match = nitroEqualizerCore.match(
        /private val frequencies = intArrayOf\(([^)]*)\)/,
    );
    if (!match) {
        throw new Error("Nitro EqualizerCore frequencies not found");
    }
    return match[1]
        .split(",")
        .map(value => Number(value.trim()))
        .filter(value => Number.isFinite(value));
}

describe("equalizer band alignment with the native DSP", () => {
    it("uses exactly the frequencies the native equalizer implements", () => {
        expect(EQUALIZER_BANDS.map(band => band.freq)).toEqual(
            nitroFrequencies(),
        );
    });

    it("keeps every preset the same length as the band list", () => {
        for (const preset of EQUALIZER_PRESETS) {
            expect(preset.gains).toHaveLength(EQUALIZER_BANDS.length);
        }
    });

    it("keeps every preset gain inside the native range", () => {
        // Nitro documents -12..+12 dB; sending values outside it is silently
        // clamped natively, which would make the UI disagree with the sound.
        for (const preset of EQUALIZER_PRESETS) {
            for (const gain of preset.gains) {
                expect(gain).toBeGreaterThanOrEqual(EQUALIZER_GAIN.min);
                expect(gain).toBeLessThanOrEqual(EQUALIZER_GAIN.max);
            }
        }
    });

    it("keeps a flat preset that is actually flat", () => {
        const flat = EQUALIZER_PRESETS.find(preset => preset.id === "flat");
        expect(flat?.gains.every(gain => gain === 0)).toBe(true);
    });

    it("reports the equalizer unsupported on the MPV backend", () => {
        // The effect binds to the player's audio session; MPV does not use it.
        expect(isEqualizerSupported("mpv")).toBe(false);
        expect(isEqualizerSupported("nitro-player")).toBe(true);
        expect(isEqualizerSupported(undefined)).toBe(true);
    });
});
