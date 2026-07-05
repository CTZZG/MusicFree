import {
    createPlaybackObserverSetupGuard,
    notifyPlaybackStateChangeSafely,
    normalizePlaybackObserverProgress,
    resolvePlaybackObserverEvent,
} from "../playbackObserverPolicy";

describe("playback observer policy", () => {
    it("maps normalized playback state to plugin events", () => {
        expect(resolvePlaybackObserverEvent("playing")).toBe("play");
        expect(resolvePlaybackObserverEvent("paused")).toBe("pause");
        expect(resolvePlaybackObserverEvent("stopped")).toBe("stop");
        expect(resolvePlaybackObserverEvent("idle")).toBe("stop");
        expect(resolvePlaybackObserverEvent("buffering")).toBeNull();
        expect(resolvePlaybackObserverEvent(null)).toBeNull();
    });

    it("reports false when there is no plugin handler", () => {
        expect(notifyPlaybackStateChangeSafely(null, { event: "play" })).toBe(
            false,
        );
    });

    it("catches synchronous plugin callback failures", () => {
        const error = new Error("plugin failed");
        const onError = jest.fn();

        const notified = notifyPlaybackStateChangeSafely(
            () => {
                throw error;
            },
            { event: "play" },
            onError,
        );

        expect(notified).toBe(false);
        expect(onError).toHaveBeenCalledWith(error);
    });

    it("catches asynchronous plugin callback failures without throwing", async () => {
        const error = new Error("plugin rejected");
        const onError = jest.fn();

        const notified = notifyPlaybackStateChangeSafely(
            () => Promise.reject(error),
            { event: "progress" },
            onError,
        );

        expect(notified).toBe(true);
        await Promise.resolve();
        expect(onError).toHaveBeenCalledWith(error);
    });

    it("normalizes progress payloads before notifying plugins", () => {
        expect(
            normalizePlaybackObserverProgress({
                position: 12.5,
                duration: "180",
            }),
        ).toEqual({
            currentTime: 12.5,
            duration: 180,
        });

        expect(
            normalizePlaybackObserverProgress({
                position: Number.NaN,
                duration: Number.POSITIVE_INFINITY,
            }),
        ).toEqual({
            currentTime: 0,
            duration: 0,
        });

        expect(
            normalizePlaybackObserverProgress({
                position: -5,
                duration: -1,
            }),
        ).toEqual({
            currentTime: 0,
            duration: 0,
        });
    });

    it("allows playback observer setup only once per guard instance", () => {
        const shouldSetup = createPlaybackObserverSetupGuard();

        expect(shouldSetup()).toBe(true);
        expect(shouldSetup()).toBe(false);
        expect(shouldSetup()).toBe(false);

        expect(createPlaybackObserverSetupGuard()()).toBe(true);
    });
});
