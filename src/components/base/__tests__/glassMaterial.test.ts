/**
 * 回归背景：0.9.0 的标签栏和迷你播放器在 Android 上能看见背后的封面和标题。
 * expo-blur 56 在 Android 上只模糊 BlurTargetView 里的内容，玻璃没给目标，
 * 一直退回成一层很淡的半透明色，看起来就是「透明度拉得太高」。
 */
import { canBlurBackdrop, getGlassMaterial } from "../glassMaterial";

function alphaOf(rgba: string) {
    const match = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(rgba);
    if (!match) {
        throw new Error(`not an rgba color: ${rgba}`);
    }
    return Number(match[1]);
}

describe("glass material", () => {
    it("blurs on supported Android only when a blur target is given", () => {
        expect(
            canBlurBackdrop({
                platform: "android",
                hasBlurTarget: true,
            }),
        ).toBe(true);
        expect(
            canBlurBackdrop({
                platform: "android",
                hasBlurTarget: false,
            }),
        ).toBe(false);
    });

    it("always blurs on iOS, where no target is needed", () => {
        expect(
            canBlurBackdrop({
                platform: "ios",
                hasBlurTarget: false,
            }),
        ).toBe(true);
    });

    it("keeps the frost nearly opaque when nothing is blurred", () => {
        for (const dark of [false, true]) {
            const material = getGlassMaterial({
                dark,
                platform: "android",
                hasBlurTarget: false,
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
                hasBlurTarget: true,
            });
            const solid = getGlassMaterial({
                dark,
                platform: "android",
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
