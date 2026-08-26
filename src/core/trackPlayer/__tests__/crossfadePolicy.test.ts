import {
    clampCrossfadeSeconds,
    DEFAULT_CROSSFADE_SECONDS,
    fadeInGain,
    fadeOutGain,
    linearGain,
    MAX_CROSSFADE_SECONDS,
    MIN_CROSSFADE_SECONDS,
    MIN_FADE_OUT_MS,
    resolveFadeOutDurationMs,
    shouldCancelFadeOut,
} from "../crossfadePolicy";

describe("clampCrossfadeSeconds", () => {
    it("坏值回落到默认时长", () => {
        expect(clampCrossfadeSeconds(undefined)).toBe(DEFAULT_CROSSFADE_SECONDS);
        expect(clampCrossfadeSeconds(NaN)).toBe(DEFAULT_CROSSFADE_SECONDS);
        expect(clampCrossfadeSeconds(Infinity)).toBe(
            DEFAULT_CROSSFADE_SECONDS,
        );
    });

    it("越界值夹到区间内", () => {
        expect(clampCrossfadeSeconds(0)).toBe(MIN_CROSSFADE_SECONDS);
        expect(clampCrossfadeSeconds(-5)).toBe(MIN_CROSSFADE_SECONDS);
        expect(clampCrossfadeSeconds(999)).toBe(MAX_CROSSFADE_SECONDS);
    });
});

describe("淡化曲线", () => {
    it("端点是 0 和 1", () => {
        expect(fadeInGain(0)).toBeCloseTo(0);
        expect(fadeInGain(1)).toBeCloseTo(1);
        expect(fadeOutGain(0)).toBeCloseTo(1);
        expect(fadeOutGain(1)).toBeCloseTo(0);
    });

    it("单调，且越界比例被夹住", () => {
        expect(fadeInGain(0.25)).toBeLessThan(fadeInGain(0.75));
        expect(fadeOutGain(0.25)).toBeGreaterThan(fadeOutGain(0.75));
        expect(fadeInGain(-1)).toBeCloseTo(0);
        expect(fadeOutGain(2)).toBeCloseTo(0);
    });

    it("等功率曲线在中点高于线性，避免中段听感发虚", () => {
        expect(fadeInGain(0.5)).toBeGreaterThan(0.5);
        expect(fadeOutGain(0.5)).toBeGreaterThan(0.5);
    });

    it("linearGain 在起止点之间插值", () => {
        expect(linearGain(0.2, 1, 0)).toBeCloseTo(0.2);
        expect(linearGain(0.2, 1, 1)).toBeCloseTo(1);
        expect(linearGain(0.2, 1, 0.5)).toBeCloseTo(0.6);
    });
});

describe("resolveFadeOutDurationMs", () => {
    const fadeSeconds = 5;

    it("还没进入淡出区时不淡出", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 100,
                duration: 200,
                fadeSeconds,
            }),
        ).toBeNull();
    });

    it("进入淡出区后按剩余时长开坡道", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 196,
                duration: 200,
                fadeSeconds,
            }),
        ).toBe(4000);
    });

    it("剩余时间极短时仍给一个最小坡道，避免听起来像突然掐断", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 199.95,
                duration: 200,
                fadeSeconds,
            }),
        ).toBe(MIN_FADE_OUT_MS);
    });

    it("时长不可信（直播流）时一律不淡出", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 5000,
                duration: 0,
                fadeSeconds,
            }),
        ).toBeNull();
        expect(
            resolveFadeOutDurationMs({
                position: 10,
                duration: NaN,
                fadeSeconds,
            }),
        ).toBeNull();
    });

    it("整首歌太短时不淡出，否则几乎全程都在淡", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 6,
                duration: 10,
                fadeSeconds,
            }),
        ).toBeNull();
    });

    it("已经播过结尾（位置超出时长）时不再开新坡道", () => {
        expect(
            resolveFadeOutDurationMs({
                position: 201,
                duration: 200,
                fadeSeconds,
            }),
        ).toBeNull();
    });
});

describe("shouldCancelFadeOut", () => {
    it("往回拖出淡出区就该取消", () => {
        expect(
            shouldCancelFadeOut({
                position: 100,
                duration: 200,
                fadeSeconds: 5,
            }),
        ).toBe(true);
    });

    it("留有回差，刚好卡在阈值附近不会反复开关", () => {
        expect(
            shouldCancelFadeOut({
                position: 195,
                duration: 200,
                fadeSeconds: 5,
            }),
        ).toBe(false);
        expect(
            shouldCancelFadeOut({
                position: 194.5,
                duration: 200,
                fadeSeconds: 5,
            }),
        ).toBe(false);
    });

    it("时长不可信时按取消处理，不把音量永远压着", () => {
        expect(
            shouldCancelFadeOut({
                position: 10,
                duration: 0,
                fadeSeconds: 5,
            }),
        ).toBe(true);
    });
});
