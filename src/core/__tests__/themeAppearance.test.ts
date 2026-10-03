import {
    resolveStoredAppearance,
    themeIdForColorScheme,
} from "../themeAppearance";

describe("resolveStoredAppearance", () => {
    it("follows the system on a fresh install", () => {
        expect(resolveStoredAppearance(undefined, undefined)).toEqual({
            themeId: "p-dark",
            followSystem: true,
            needsPersist: true,
        });
    });

    it("keeps an explicit light or dark choice", () => {
        expect(resolveStoredAppearance("p-light", false)).toEqual({
            themeId: "p-light",
            followSystem: false,
            needsPersist: false,
        });
        expect(resolveStoredAppearance("p-dark", true)).toEqual({
            themeId: "p-dark",
            followSystem: true,
            needsPersist: false,
        });
    });

    it("records an explicit choice that never stored the follow-system flag", () => {
        expect(resolveStoredAppearance("p-dark", undefined)).toEqual({
            themeId: "p-dark",
            followSystem: false,
            needsPersist: true,
        });
    });

    it("moves removed glass themes to follow the system, light when it cannot", () => {
        for (const removed of ["p-frosted-glass", "p-liquid-glass"]) {
            expect(resolveStoredAppearance(removed, false)).toEqual({
                themeId: "p-light",
                followSystem: true,
                needsPersist: true,
            });
        }
    });

    it("moves custom color themes to follow the system, dark when it cannot", () => {
        expect(resolveStoredAppearance("custom", false)).toEqual({
            themeId: "p-dark",
            followSystem: true,
            needsPersist: true,
        });
    });
});

describe("themeIdForColorScheme", () => {
    it("maps the system color scheme", () => {
        expect(themeIdForColorScheme("dark", "p-light")).toBe("p-dark");
        expect(themeIdForColorScheme("light", "p-dark")).toBe("p-light");
    });

    it("keeps the fallback when the system does not report a scheme", () => {
        expect(themeIdForColorScheme(null, "p-dark")).toBe("p-dark");
        expect(themeIdForColorScheme(undefined, "p-light")).toBe("p-light");
    });
});
