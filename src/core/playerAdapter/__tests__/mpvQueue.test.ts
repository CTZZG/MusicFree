import {
    collectMpvNextIndices,
    computeMpvNextIndex,
    computeMpvPreviousIndex,
    isValidMpvQueueIndex,
    resolveMpvPlayAction,
    resolveMpvCurrentIndexAfterQueueSync,
    resolveMpvLoadQueueStartIndex,
} from "../mpvQueue";

describe("mpv queue helpers", () => {
    it("validates queue indices", () => {
        expect(isValidMpvQueueIndex(0, 1)).toBe(true);
        expect(isValidMpvQueueIndex(-1, 1)).toBe(false);
        expect(isValidMpvQueueIndex(1, 1)).toBe(false);
        expect(isValidMpvQueueIndex(0, 0)).toBe(false);
    });

    it("resolves active indices after queue sync", () => {
        expect(
            resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: 2,
                queueLength: 4,
                activeIndex: 1,
            }),
        ).toBe(1);
        expect(
            resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: 2,
                queueLength: 4,
                activeIndex: -1,
            }),
        ).toBe(-1);
        expect(
            resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: 2,
                queueLength: 4,
                activeIndex: null,
            }),
        ).toBe(-1);
        expect(
            resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: 2,
                queueLength: 4,
            }),
        ).toBe(2);
        expect(
            resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: 4,
                queueLength: 4,
            }),
        ).toBe(-1);
    });

    it("resolves load-queue start indices", () => {
        expect(resolveMpvLoadQueueStartIndex(3, 1)).toBe(1);
        expect(resolveMpvLoadQueueStartIndex(3, -1)).toBeNull();
        expect(resolveMpvLoadQueueStartIndex(3, 3)).toBeNull();
        expect(resolveMpvLoadQueueStartIndex(0, 0)).toBeNull();
    });

    it("advances to the next item inside the queue", () => {
        expect(
            computeMpvNextIndex(
                { currentIndex: 0, queueLength: 3, repeatMode: "queue" },
                false,
            ),
        ).toBe(1);
    });

    it("wraps natural playback only in queue repeat mode", () => {
        expect(
            computeMpvNextIndex(
                { currentIndex: 2, queueLength: 3, repeatMode: "queue" },
                false,
            ),
        ).toBe(0);
        expect(
            computeMpvNextIndex(
                { currentIndex: 2, queueLength: 3, repeatMode: "off" },
                false,
            ),
        ).toBeNull();
        expect(
            computeMpvNextIndex(
                { currentIndex: 2, queueLength: 3, repeatMode: "track" },
                false,
            ),
        ).toBeNull();
    });

    it("wraps manual skip at the queue end", () => {
        expect(
            computeMpvNextIndex(
                { currentIndex: 2, queueLength: 3, repeatMode: "off" },
                true,
            ),
        ).toBe(0);
    });

    it("resolves previous tracks with wrapping and single-item restart semantics", () => {
        expect(
            computeMpvPreviousIndex({
                currentIndex: 0,
                queueLength: 3,
                repeatMode: "off",
            }),
        ).toBe(2);
        expect(
            computeMpvPreviousIndex({
                currentIndex: 2,
                queueLength: 3,
                repeatMode: "queue",
            }),
        ).toBe(1);
        expect(
            computeMpvPreviousIndex({
                currentIndex: 0,
                queueLength: 1,
                repeatMode: "track",
            }),
        ).toBe(0);
    });

    it("previews wrapped next tracks without returning the current item", () => {
        expect(
            collectMpvNextIndices(
                { currentIndex: 2, queueLength: 4, repeatMode: "queue" },
                3,
            ),
        ).toEqual([3, 0, 1]);
        expect(
            collectMpvNextIndices(
                { currentIndex: 0, queueLength: 1, repeatMode: "queue" },
                3,
            ),
        ).toEqual([]);
    });

    it("does not preview past the queue end without queue repeat", () => {
        expect(
            collectMpvNextIndices(
                { currentIndex: 1, queueLength: 3, repeatMode: "off" },
                3,
            ),
        ).toEqual([2]);
    });

    it("returns no indices for inactive, stale, or empty queues", () => {
        expect(
            computeMpvNextIndex(
                { currentIndex: -1, queueLength: 0, repeatMode: "queue" },
                true,
            ),
        ).toBeNull();
        expect(
            computeMpvNextIndex(
                { currentIndex: -1, queueLength: 3, repeatMode: "queue" },
                true,
            ),
        ).toBeNull();
        expect(
            computeMpvNextIndex(
                { currentIndex: 3, queueLength: 3, repeatMode: "queue" },
                true,
            ),
        ).toBeNull();
        expect(
            collectMpvNextIndices(
                { currentIndex: -1, queueLength: 3, repeatMode: "queue" },
                1,
            ),
        ).toEqual([]);
        expect(
            collectMpvNextIndices(
                { currentIndex: 3, queueLength: 3, repeatMode: "queue" },
                3,
            ),
        ).toEqual([]);
        expect(
            computeMpvPreviousIndex({
                currentIndex: -1,
                queueLength: 3,
                repeatMode: "queue",
            }),
        ).toBeNull();
        expect(
            computeMpvPreviousIndex({
                currentIndex: 0,
                queueLength: 0,
                repeatMode: "queue",
            }),
        ).toBeNull();
        expect(
            computeMpvPreviousIndex({
                currentIndex: 3,
                queueLength: 3,
                repeatMode: "queue",
            }),
        ).toBeNull();
    });

    it("reloads the current item when play is requested before native load", () => {
        expect(
            resolveMpvPlayAction({
                hasLoaded: false,
                currentState: "idle",
                currentIndex: 0,
                queueLength: 2,
                isAtTrackEnd: false,
            }),
        ).toBe("reload-current");
    });

    it("resumes native playback when the loaded current item is still valid", () => {
        expect(
            resolveMpvPlayAction({
                hasLoaded: true,
                currentState: "paused",
                currentIndex: 1,
                queueLength: 2,
                isAtTrackEnd: false,
            }),
        ).toBe("resume");
    });

    it("finishes the current track when play is requested after seeking to the end", () => {
        expect(
            resolveMpvPlayAction({
                hasLoaded: true,
                currentState: "paused",
                currentIndex: 1,
                queueLength: 2,
                isAtTrackEnd: true,
            }),
        ).toBe("finish-ended");
    });

    it("does not resume a stale native item when the current queue index is invalid", () => {
        expect(
            resolveMpvPlayAction({
                hasLoaded: true,
                currentState: "paused",
                currentIndex: -1,
                queueLength: 2,
                isAtTrackEnd: false,
            }),
        ).toBe("none");
        expect(
            resolveMpvPlayAction({
                hasLoaded: true,
                currentState: "paused",
                currentIndex: 2,
                queueLength: 2,
                isAtTrackEnd: false,
            }),
        ).toBe("none");
    });

    it("reloads a valid queue item when native playback has gone idle or errored", () => {
        for (const currentState of ["idle", "stopped", "error"] as const) {
            expect(
                resolveMpvPlayAction({
                    hasLoaded: true,
                    currentState,
                    currentIndex: 0,
                    queueLength: 2,
                    isAtTrackEnd: false,
                }),
            ).toBe("reload-current");
        }
    });
});
