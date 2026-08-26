import { resolvePanelKeyboardOffset } from "../panelKeyboardPolicy";

describe("resolvePanelKeyboardOffset", () => {
    it("lifts the panel by the overlap with the keyboard", () => {
        expect(
            resolvePanelKeyboardOffset({
                panelBottomY: 800,
                keyboardScreenY: 500,
            }),
        ).toBe(300);
    });

    it("does not lift when the panel already sits above the keyboard", () => {
        expect(
            resolvePanelKeyboardOffset({
                panelBottomY: 420,
                keyboardScreenY: 500,
            }),
        ).toBe(0);
    });

    it("ignores unusable keyboard metrics", () => {
        expect(
            resolvePanelKeyboardOffset({
                panelBottomY: 800,
                keyboardScreenY: 0,
            }),
        ).toBe(0);
        expect(
            resolvePanelKeyboardOffset({
                panelBottomY: Number.NaN,
                keyboardScreenY: 500,
            }),
        ).toBe(0);
        expect(
            resolvePanelKeyboardOffset({
                panelBottomY: 800,
                keyboardScreenY: Number.POSITIVE_INFINITY,
            }),
        ).toBe(0);
    });
});
