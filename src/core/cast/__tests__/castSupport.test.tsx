import React from "react";
import {
    act,
    create,
    ReactTestRenderer,
} from "react-test-renderer";

jest.mock("react-native-nitro-player", () => ({
    Cast: { configure: jest.fn(async () => undefined) },
}));
jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
}));

import {
    isCastButtonVisible,
    isCastSupported,
} from "../support";
import {
    getCastSetupStatus,
    resetCastStateForTests,
    setupCast,
    useCastReady,
} from "../index";

const { Cast } = jest.requireMock("react-native-nitro-player");

describe("cast support", () => {
    let renderer: ReactTestRenderer | undefined;
    let latestReady = false;

    function ReadinessProbe() {
        latestReady = useCastReady();
        return null;
    }

    beforeEach(() => {
        Cast.configure.mockReset();
        Cast.configure.mockResolvedValue(undefined);
        resetCastStateForTests();
        latestReady = false;
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    // Casting is a backend swap inside Nitro's playback core. MPV has its own
    // audio path and never reaches that core, so offering the button there would
    // repeat the equalizer mistake: a control that visibly does nothing.
    it("is unavailable on the MPV backend", () => {
        expect(isCastSupported("mpv")).toBe(false);
        expect(isCastSupported("nitro-player")).toBe(true);
        expect(isCastSupported(undefined)).toBe(true);
        expect(isCastButtonVisible("mpv", true)).toBe(false);
        expect(isCastButtonVisible("nitro-player", false)).toBe(false);
        expect(isCastButtonVisible("nitro-player", true)).toBe(true);
    });

    it("shares one configure attempt across concurrent callers", async () => {
        let resolveConfigure!: () => void;
        Cast.configure.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resolveConfigure = resolve;
                }),
        );

        const first = setupCast();
        const second = setupCast();

        expect(first).toBe(second);
        expect(getCastSetupStatus()).toBe("configuring");
        await Promise.resolve();
        expect(Cast.configure).toHaveBeenCalledTimes(1);

        resolveConfigure();
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(getCastSetupStatus()).toBe("ready");

        await expect(setupCast()).resolves.toBe(true);
        expect(Cast.configure).toHaveBeenCalledTimes(1);
    });

    it("keeps the UI hidden after failure and allows a later retry", async () => {
        Cast.configure
            .mockRejectedValueOnce(new Error("no play services"))
            .mockResolvedValueOnce(undefined);

        await expect(setupCast()).resolves.toBe(false);
        expect(getCastSetupStatus()).toBe("unavailable");
        expect(isCastButtonVisible("nitro-player", false)).toBe(false);

        await expect(setupCast()).resolves.toBe(true);
        expect(Cast.configure).toHaveBeenCalledTimes(2);
        expect(getCastSetupStatus()).toBe("ready");
    });

    it("notifies readiness consumers when setup succeeds", async () => {
        act(() => {
            renderer = create(<ReadinessProbe />);
        });
        expect(latestReady).toBe(false);

        await act(async () => {
            await setupCast();
        });

        expect(latestReady).toBe(true);
    });

    it("ignores completion from an attempt invalidated by a test reset", async () => {
        let resolveConfigure!: () => void;
        Cast.configure.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resolveConfigure = resolve;
                }),
        );

        const staleAttempt = setupCast();
        await Promise.resolve();
        resetCastStateForTests();
        resolveConfigure();

        await expect(staleAttempt).resolves.toBe(false);
        expect(getCastSetupStatus()).toBe("idle");

        await expect(setupCast()).resolves.toBe(true);
        expect(Cast.configure).toHaveBeenCalledTimes(2);
    });
});
