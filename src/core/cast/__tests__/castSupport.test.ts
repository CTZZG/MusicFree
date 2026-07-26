jest.mock("react-native-nitro-player", () => ({
    Cast: { configure: jest.fn(async () => undefined) },
}));
jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
}));

import { isCastSupported } from "../support";
import { setupCast } from "../index";

const { Cast } = jest.requireMock("react-native-nitro-player");

describe("cast support", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Casting is a backend swap inside Nitro's playback core. MPV has its own
    // audio path and never reaches that core, so offering the button there would
    // repeat the equalizer mistake: a control that visibly does nothing.
    it("is unavailable on the MPV backend", () => {
        expect(isCastSupported("mpv")).toBe(false);
        expect(isCastSupported("nitro-player")).toBe(true);
        expect(isCastSupported(undefined)).toBe(true);
    });

    it("configures the Cast framework only once", async () => {
        await expect(setupCast()).resolves.toBe(true);
        await expect(setupCast()).resolves.toBe(true);
        expect(Cast.configure).toHaveBeenCalledTimes(1);
    });
});
