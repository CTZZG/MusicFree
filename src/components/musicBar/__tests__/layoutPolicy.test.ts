import { resolveMusicBarLayout } from "../layoutPolicy";

const baseInput = {
    routeSupportsMusicBar: true,
    hasCurrentMusic: true,
    keyboardVisible: false,
    drawerOpen: false,
    floatingTheme: false,
    barHeight: 132,
    floatingBottom: 20,
};

describe("resolveMusicBarLayout", () => {
    it.each([
        ["unsupported route", { routeSupportsMusicBar: false }],
        ["empty player", { hasCurrentMusic: false }],
        ["visible keyboard", { keyboardVisible: true }],
        ["open drawer", { drawerOpen: true }],
    ])("does not reserve a phantom inset for %s", (_label, patch) => {
        expect(resolveMusicBarLayout({ ...baseInput, ...patch })).toEqual({
            visible: false,
            presentation: "hidden",
            reservedBottom: 0,
        });
    });

    it("reserves the full docked bar height in ordinary themes", () => {
        expect(resolveMusicBarLayout(baseInput)).toEqual({
            visible: true,
            presentation: "docked",
            reservedBottom: 132,
        });
    });

    it("reserves the bar and floating gap in the frosted theme", () => {
        expect(
            resolveMusicBarLayout({ ...baseInput, floatingTheme: true }),
        ).toEqual({
            visible: true,
            presentation: "floating",
            reservedBottom: 152,
        });
    });
});
