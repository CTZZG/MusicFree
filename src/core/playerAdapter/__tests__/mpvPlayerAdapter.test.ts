const mockListeners: Record<string, ((event: any) => void) | undefined> = {};

const mockNativeMpvPlayer = {
    isAvailable: jest.fn(() => true),
    initialize: jest.fn(async () => undefined),
    destroy: jest.fn(async () => undefined),
    loadAndPlay: jest.fn(async () => undefined),
    prepareNext: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    seekTo: jest.fn(async () => undefined),
    setVolume: jest.fn(async () => undefined),
    setRate: jest.fn(async () => undefined),
    getIsPlaying: jest.fn(async () => true),
    getPosition: jest.fn(async () => 0),
    getDuration: jest.fn(async () => 180),
    isAndroidAutoConnected: jest.fn(async () => false),
    updateQueueSnapshot: jest.fn(async () => undefined),
    updateMetadata: jest.fn(async () => undefined),
    addStateChangedListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.state = cb;
        return { remove: jest.fn() };
    }),
    addProgressListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.progress = cb;
        return { remove: jest.fn() };
    }),
    addActiveTrackChangedListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.active = cb;
        return { remove: jest.fn() };
    }),
    addEndedListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.ended = cb;
        return { remove: jest.fn() };
    }),
    addErrorListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.error = cb;
        return { remove: jest.fn() };
    }),
    addRemoteCommandListener: jest.fn((cb: (event: any) => void) => {
        mockListeners.remote = cb;
        return { remove: jest.fn() };
    }),
    addAndroidAutoConnectionChangedListener: jest.fn(
        (cb: (event: any) => void) => {
            mockListeners.auto = cb;
            return { remove: jest.fn() };
        },
    ),
};

jest.mock("../nativeMpvPlayer", () => ({
    __esModule: true,
    ...mockNativeMpvPlayer,
    default: mockNativeMpvPlayer,
}));
jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: (item: {platform?: string; id: string}) =>
        item.platform ? `${item.platform}@${item.id}` : item.id,
}));
jest.mock("@/utils/log", () => ({
    trace: jest.fn(),
    errorLog: jest.fn(),
}));

import type { MpvTrack } from "../mpvPlayerAdapter";

const { MpvPlayerAdapter } = require("../mpvPlayerAdapter") as typeof import("../mpvPlayerAdapter");

const track = (id: string): MpvTrack => ({
    id,
    title: id.toUpperCase(),
    url: `https://example.test/${id}.mp3`,
});

async function createAdapter() {
    const adapter = new MpvPlayerAdapter();
    await adapter.setup();
    return adapter;
}

function lastLoadPayload() {
    return (mockNativeMpvPlayer.loadAndPlay.mock.calls as any[]).at(-1)?.[0] as any;
}

function lastPreparePayload() {
    return (mockNativeMpvPlayer.prepareNext.mock.calls as any[]).at(-1)?.[0] as any;
}

async function confirmLastExplicitLoad() {
    const payload = lastLoadPayload();
    expect(payload).toBeTruthy();
    mockListeners.active?.({
        mediaId: payload.mediaId,
        loadGeneration: payload.loadGeneration,
        prepareToken: 0,
        queueRevision: payload.queueRevision,
        source: "loaded",
    });
    await Promise.resolve();
}

async function flushAsyncEvents() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe("MpvPlayerAdapter identity state machine", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const key of Object.keys(mockListeners)) {
            delete mockListeners[key];
        }
        mockNativeMpvPlayer.loadAndPlay.mockResolvedValue(undefined);
        mockNativeMpvPlayer.prepareNext.mockResolvedValue(undefined);
    });

    it("commits B and prepared C only after native identity confirmation", async () => {
        const adapter = await createAdapter();
        const changes: any[] = [];
        adapter.addEventListener("trackChanged", event => changes.push(event));

        await adapter.loadQueue([track("a"), track("b"), track("c")], 1);
        expect(await adapter.getActiveTrack()).toBeNull();
        expect(changes).toHaveLength(0);

        await confirmLastExplicitLoad();
        expect((await adapter.getActiveTrack())?.id).toBe("b");
        expect(changes.map(item => item.track.id)).toEqual(["b"]);
        const loaded = lastLoadPayload();
        mockListeners.active?.({
            mediaId: loaded.mediaId,
            loadGeneration: loaded.loadGeneration,
            prepareToken: 0,
            queueRevision: loaded.queueRevision,
            source: "loaded",
        });
        await Promise.resolve();
        expect(changes).toHaveLength(1);

        await adapter.prepareNextTrack(track("c"));
        const prepared = lastPreparePayload();
        expect(prepared.mediaId).toBe("c");
        expect(prepared.prepareToken).toBeGreaterThan(0);

        mockListeners.active?.({
            mediaId: prepared.mediaId,
            loadGeneration: prepared.loadGeneration,
            prepareToken: prepared.prepareToken,
            queueRevision: prepared.queueRevision,
            source: "prepared",
        });
        await Promise.resolve();
        expect((await adapter.getActiveTrack())?.id).toBe("c");
        expect(changes.at(-1)?.reason).toBe("end");

        mockListeners.ended?.({
            reason: "end",
            autoAdvanced: true,
            endedMediaId: "b",
            promotedMediaId: prepared.mediaId,
            loadGeneration: prepared.loadGeneration,
            prepareToken: prepared.prepareToken,
            queueRevision: prepared.queueRevision,
        });
        await Promise.resolve();
        expect(mockNativeMpvPlayer.loadAndPlay).toHaveBeenCalledTimes(1);
    });

    it("keeps an accepted promotion when the next prepare starts before ended arrives", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue(
            [track("a"), track("b"), track("c"), track("d")],
            1,
        );
        await confirmLastExplicitLoad();
        await adapter.prepareNextTrack(track("c"));
        const promoted = lastPreparePayload();
        mockNativeMpvPlayer.stop.mockClear();

        adapter.addEventListener("trackChanged", event => {
            if (event.reason === "end" && event.track?.id === "c") {
                adapter.prepareNextTrack(track("d")).catch(() => undefined);
            }
        });

        mockListeners.active?.({
            mediaId: promoted.mediaId,
            loadGeneration: promoted.loadGeneration,
            prepareToken: promoted.prepareToken,
            queueRevision: promoted.queueRevision,
            source: "prepared",
        });
        await flushAsyncEvents();
        expect(lastPreparePayload().mediaId).toBe("d");
        expect((adapter as any).confirmedPromotion?.mediaId).toBe("c");

        mockListeners.ended?.({
            reason: "end",
            autoAdvanced: true,
            endedMediaId: "b",
            promotedMediaId: promoted.mediaId,
            loadGeneration: promoted.loadGeneration,
            prepareToken: promoted.prepareToken,
            queueRevision: promoted.queueRevision,
        });
        await flushAsyncEvents();

        expect(mockNativeMpvPlayer.stop).not.toHaveBeenCalled();
        expect(mockNativeMpvPlayer.loadAndPlay).toHaveBeenCalledTimes(1);
        expect((await adapter.getActiveTrack())?.id).toBe("c");
    });

    it("commits the promoted item when ended arrives before activeTrackChanged", async () => {
        const adapter = await createAdapter();
        const changes: any[] = [];
        adapter.addEventListener("trackChanged", event => changes.push(event));
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();
        await adapter.prepareNextTrack(track("b"));
        const prepared = lastPreparePayload();

        mockListeners.ended?.({
            reason: "end",
            autoAdvanced: true,
            endedMediaId: "a",
            promotedMediaId: prepared.mediaId,
            loadGeneration: prepared.loadGeneration,
            prepareToken: prepared.prepareToken,
            queueRevision: prepared.queueRevision,
        });
        await flushAsyncEvents();

        expect((await adapter.getActiveTrack())?.id).toBe("b");
        expect(changes.map(item => item.track.id)).toEqual(["a", "b"]);

        mockListeners.active?.({
            mediaId: prepared.mediaId,
            loadGeneration: prepared.loadGeneration,
            prepareToken: prepared.prepareToken,
            queueRevision: prepared.queueRevision,
            source: "prepared",
        });
        await flushAsyncEvents();
        expect(changes.map(item => item.track.id)).toEqual(["a", "b"]);
    });

    it("keeps repeated preparation of the same adjacent item idempotent", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();

        await adapter.prepareNextTrack(track("b"));
        const firstPrepared = lastPreparePayload();
        await adapter.prepareNextTrack(track("b"));

        expect(mockNativeMpvPlayer.prepareNext).toHaveBeenCalledTimes(1);
        expect(lastPreparePayload()).toEqual(firstPrepared);
    });

    it("does not prepare the wrapped first item from the last queue item", async () => {
        const adapter = await createAdapter();
        const playEnds: any[] = [];
        adapter.addEventListener("playEnd", event => playEnds.push(event));
        await adapter.loadQueue([track("a"), track("b"), track("c")], 2);
        await confirmLastExplicitLoad();

        await adapter.prepareNextTrack(track("a"));
        expect(lastPreparePayload()).toBeNull();

        mockListeners.ended?.({
            reason: "end",
            autoAdvanced: false,
            endedMediaId: "c",
        });
        await Promise.resolve();
        expect((await adapter.getActiveTrack())?.id).toBe("c");
        expect(playEnds).toHaveLength(1);
        expect(mockNativeMpvPlayer.loadAndPlay).toHaveBeenCalledTimes(1);
    });

    it("rejects a late prepared identity after queue revision changes", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b"), track("c")], 1);
        await confirmLastExplicitLoad();
        await adapter.prepareNextTrack(track("c"));
        const stale = lastPreparePayload();

        await adapter.syncQueueOrder([track("a"), track("b"), track("d")]);
        mockListeners.active?.({
            mediaId: stale.mediaId,
            loadGeneration: stale.loadGeneration,
            prepareToken: stale.prepareToken,
            queueRevision: stale.queueRevision,
            source: "prepared",
        });
        await flushAsyncEvents();

        expect(mockNativeMpvPlayer.stop).toHaveBeenCalled();
        expect(lastLoadPayload().mediaId).toBe("b");
    });

    it("does not create a prepared track in single repeat mode", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();
        await adapter.setRepeatMode("track");
        await adapter.prepareNextTrack(track("b"));
        expect(lastPreparePayload()).toBeNull();
    });

    it("does not silently play item zero for an invalid start index", async () => {
        const adapter = await createAdapter();
        const errors: any[] = [];
        adapter.addEventListener("playbackError", event => errors.push(event));
        await adapter.loadQueue([track("a"), track("b")], 9);
        expect(mockNativeMpvPlayer.loadAndPlay).not.toHaveBeenCalled();
        expect(errors.at(-1)?.code).toBe("mpv-invalid-start-index");
    });

    it("never commits an older native activation after a newer skip target", async () => {
        const adapter = await createAdapter();
        const changes: any[] = [];
        adapter.addEventListener("trackChanged", event => changes.push(event));

        await adapter.loadQueue([track("a"), track("b"), track("c")], 0);
        const staleLoad = lastLoadPayload();
        await adapter.skipToNext();
        const requestedNext = lastLoadPayload();
        expect(requestedNext.mediaId).toBe("b");

        mockListeners.active?.({
            mediaId: staleLoad.mediaId,
            loadGeneration: staleLoad.loadGeneration,
            prepareToken: 0,
            queueRevision: staleLoad.queueRevision,
            source: "loaded",
        });
        await flushAsyncEvents();

        expect(await adapter.getActiveTrack()).toBeNull();
        expect(changes).toHaveLength(0);
        expect(mockNativeMpvPlayer.stop).toHaveBeenCalled();
        const recoveredNext = lastLoadPayload();
        expect(recoveredNext.mediaId).toBe("b");
        expect(recoveredNext.loadGeneration).not.toBe(
            staleLoad.loadGeneration,
        );

        mockListeners.active?.({
            mediaId: recoveredNext.mediaId,
            loadGeneration: recoveredNext.loadGeneration,
            prepareToken: 0,
            queueRevision: recoveredNext.queueRevision,
            source: "loaded",
        });
        await flushAsyncEvents();

        expect((await adapter.getActiveTrack())?.id).toBe("b");
        expect(changes.map(item => item.track.id)).toEqual(["b"]);
    });

    it("restores the last confirmed item and resets next navigation after rollback", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b"), track("c")], 0);
        await confirmLastExplicitLoad();

        await adapter.skipToNext();
        expect(lastLoadPayload().mediaId).toBe("b");

        const restorePromise = adapter.restoreActiveTrack({
            autoPlay: false,
        });
        await flushAsyncEvents();
        const restored = lastLoadPayload();
        expect(restored.mediaId).toBe("a");
        expect(restored.autoPlay).toBe(false);
        mockListeners.active?.({
            mediaId: restored.mediaId,
            loadGeneration: restored.loadGeneration,
            prepareToken: 0,
            queueRevision: restored.queueRevision,
            source: "loaded",
        });
        await expect(restorePromise).resolves.toBe(true);
        expect((await adapter.getActiveTrack())?.id).toBe("a");

        await adapter.skipToNext();
        expect(lastLoadPayload().mediaId).toBe("b");
    });

    it("follows a recovery reload when a stale activation arrives during rollback", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();

        await adapter.skipToNext();
        const staleTarget = lastLoadPayload();
        const restorePromise = adapter.restoreActiveTrack({
            autoPlay: true,
        });
        await flushAsyncEvents();
        const firstRestore = lastLoadPayload();
        expect(firstRestore.mediaId).toBe("a");

        mockListeners.active?.({
            mediaId: staleTarget.mediaId,
            loadGeneration: staleTarget.loadGeneration,
            prepareToken: 0,
            queueRevision: staleTarget.queueRevision,
            source: "loaded",
        });
        await flushAsyncEvents();
        const recoveryRestore = lastLoadPayload();
        expect(recoveryRestore.mediaId).toBe("a");
        expect(recoveryRestore.loadGeneration).not.toBe(
            firstRestore.loadGeneration,
        );

        mockListeners.active?.({
            mediaId: recoveryRestore.mediaId,
            loadGeneration: recoveryRestore.loadGeneration,
            prepareToken: 0,
            queueRevision: recoveryRestore.queueRevision,
            source: "loaded",
        });

        await expect(restorePromise).resolves.toBe(true);
        expect((await adapter.getActiveTrack())?.id).toBe("a");
    });

    it("realigns from an unresolved URL target before the next intent", async () => {
        const adapter = await createAdapter();
        const unresolved = { ...track("b"), url: "" };
        const requestedUpdates: any[] = [];
        adapter.addEventListener("tracksNeedUpdate", event =>
            requestedUpdates.push(event),
        );
        await adapter.loadQueue([track("a"), unresolved, track("c")], 0);
        await confirmLastExplicitLoad();
        mockNativeMpvPlayer.loadAndPlay.mockClear();

        await adapter.skipToNext();
        expect(mockNativeMpvPlayer.loadAndPlay).not.toHaveBeenCalled();
        expect(requestedUpdates.at(-1)?.tracks?.[0]?.id).toBe("b");

        const restorePromise = adapter.restoreActiveTrack({
            autoPlay: false,
        });
        await flushAsyncEvents();
        const restored = lastLoadPayload();
        expect(restored.mediaId).toBe("a");
        mockListeners.active?.({
            mediaId: restored.mediaId,
            loadGeneration: restored.loadGeneration,
            prepareToken: 0,
            queueRevision: restored.queueRevision,
            source: "loaded",
        });
        await expect(restorePromise).resolves.toBe(true);

        await adapter.updateTrack(track("b"), 1);
        await adapter.skipToNext();
        expect(lastLoadPayload().mediaId).toBe("b");
    });

    it("keeps the confirmed active item when the next load command fails", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();
        mockNativeMpvPlayer.loadAndPlay.mockRejectedValueOnce(
            new Error("load failed"),
        );

        await adapter.skipToNext();
        expect((await adapter.getActiveTrack())?.id).toBe("a");
        expect(await adapter.getActiveTrackIndex()).toBe(0);
    });

    it("keeps confirmed active identity when replacing the queue load fails", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b")], 0);
        await confirmLastExplicitLoad();
        mockNativeMpvPlayer.loadAndPlay.mockRejectedValueOnce(
            new Error("replace failed"),
        );

        await adapter.loadQueue([track("a"), track("b")], 1);
        expect((await adapter.getActiveTrack())?.id).toBe("a");
        expect(await adapter.getActiveTrackIndex()).toBe(0);
    });

    it("relocates the active index by confirmed media id after reorder", async () => {
        const adapter = await createAdapter();
        await adapter.loadQueue([track("a"), track("b"), track("c")], 1);
        await confirmLastExplicitLoad();

        await adapter.syncQueueOrder([track("c"), track("a"), track("b")]);
        expect((await adapter.getActiveTrack())?.id).toBe("b");
        expect(await adapter.getActiveTrackIndex()).toBe(2);
    });

    it("explicitly clears native notification artwork when current artwork is absent", async () => {
        const adapter = await createAdapter();
        const withArtwork = {
            ...track("a"),
            artwork: "file:///cache/old-cover.jpg",
        };
        await adapter.loadQueue([withArtwork], 0);
        await confirmLastExplicitLoad();

        await adapter.updateTrack({ ...withArtwork, artwork: null } as any, 0);
        expect(mockNativeMpvPlayer.updateMetadata).toHaveBeenLastCalledWith(
            expect.objectContaining({ artwork: null }),
        );
    });
});
