/**
 * 回归背景：0.9.0 的标签栏和迷你播放器在 Android 上能看见背后的封面和标题。
 * expo-blur 56 在 Android 上只模糊 BlurTargetView 里的内容，玻璃没给目标，
 * 一直退回成一层很淡的半透明色，看起来就是「透明度拉得太高」。
 */
import {
    canBlurBackdrop,
    getGlassMaterial,
    MIN_ANDROID_BLUR_API,
} from "../glassMaterial";

function alphaOf(rgba: string) {
    const match = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(rgba);
    if (!match) {
        throw new Error(`not an rgba color: ${rgba}`);
    }
    return Number(match[1]);
}

describe("glass material", () => {
    it("blurs on Android 12+ only when a blur target is given", () => {
        expect(
            canBlurBackdrop({
                platform: "android",
                platformVersion: 34,
                hasBlurTarget: true,
            }),
        ).toBe(true);
        expect(
            canBlurBackdrop({
                platform: "android",
                platformVersion: 34,
                hasBlurTarget: false,
            }),
        ).toBe(false);
        expect(
            canBlurBackdrop({
                platform: "android",
                platformVersion: MIN_ANDROID_BLUR_API - 1,
                hasBlurTarget: true,
            }),
        ).toBe(false);
        expect(
            canBlurBackdrop({
                platform: "android",
                platformVersion: String(MIN_ANDROID_BLUR_API),
                hasBlurTarget: true,
            }),
        ).toBe(true);
    });

    it("always blurs on iOS, where no target is needed", () => {
        expect(
            canBlurBackdrop({
                platform: "ios",
                platformVersion: "17.0",
                hasBlurTarget: false,
            }),
        ).toBe(true);
    });

    it("keeps the frost nearly opaque when nothing is blurred", () => {
        for (const dark of [false, true]) {
            const material = getGlassMaterial({
                dark,
                platform: "android",
                platformVersion: MIN_ANDROID_BLUR_API - 1,
                hasBlurTarget: true,
            });
            expect(material.blur).toBe(false);
            expect(alphaOf(material.frostColor)).toBeGreaterThanOrEqual(0.9);
        }
    });

    it("uses a thinner, but still substantial, frost over a real blur", () => {
        for (const dark of [false, true]) {
            const blurred = getGlassMaterial({
                dark,
                platform: "android",
                platformVersion: 34,
                hasBlurTarget: true,
            });
            const solid = getGlassMaterial({
                dark,
                platform: "android",
                platformVersion: 34,
                hasBlurTarget: false,
            });
            expect(blurred.blur).toBe(true);
            expect(alphaOf(blurred.frostColor)).toBeLessThan(
                alphaOf(solid.frostColor),
            );
            expect(alphaOf(blurred.frostColor)).toBeGreaterThanOrEqual(0.5);
        }
    });
});
