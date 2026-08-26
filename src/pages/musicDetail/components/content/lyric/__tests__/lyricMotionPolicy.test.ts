import { getLyricMotionPolicy } from "../lyricMotionPolicy";

describe("lyric motion policy", () => {
    it("preserves configured animation when reduce-motion is disabled", () => {
        expect(getLyricMotionPolicy({
            reduceMotionEnabled: false,
            enableWordByWord: true,
            enableWordByWordFloat: true,
            enableBreathingDots: true,
        })).toEqual({
            animateWordByWord: true,
            animateWordFloat: true,
            animateBreathingDots: true,
            animateLineTransition: true,
        });
    });

    it("turns playback-driven lyric animation into static content", () => {
        expect(getLyricMotionPolicy({
            reduceMotionEnabled: true,
            enableWordByWord: true,
            enableWordByWordFloat: true,
            enableBreathingDots: true,
        })).toEqual({
            animateWordByWord: false,
            animateWordFloat: false,
            animateBreathingDots: false,
            animateLineTransition: false,
        });
    });
});
