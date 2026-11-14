const mockEvents: Record<string, (event: any) => void> = {};
const mockNative = {
    isAvailable: () => true,
    initialize: jest.fn(async () => undefined),
    isAndroidAutoConnected: jest.fn(async () => false),
    loadAndPlay: jest.fn(async (): Promise<number | null> => 37.25),
    prepareNext: jest.fn(async () => undefined),
    prepareNextBatch: jest.fn(async () => undefined),
    updateQueueSnapshot: jest.fn(async () => undefined),
    updateMetadata: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    setRate: jest.fn(async () => undefined),
    getPosition: jest.fn(async () => 37.25),
    getDuration: jest.fn(async () => 300),
    getRenditionProgress: jest.fn(async (): Promise<any> => null),
    addStateChangedListener: (fn: any) => {
        mockEvents.state = fn; 
    },
    addProgressListener: (fn: any) => {
        mockEvents.progress = fn; 
    },
    addActiveTrackChangedListener: (fn: any) => {
        mockEvents.active = fn; 
    },
    addEndedListener: (fn: any) => {
        mockEvents.ended = fn; 
    },
    addErrorListener: (fn: any) => {
        mockEvents.error = fn; 
    },
    addRemoteCommandListener: (fn: any) => {
        mockEvents.remote = fn;
    },
    addAndroidAutoConnectionChangedListener: () => undefined,
    addBrowseRequestListener: () => undefined,
};
jest.mock("../nativeMpvPlayer", () => ({ __esModule: true, default: mockNative }));
jest.mock("@/utils/mediaUtils", () => ({ getMediaUniqueKey: (item: any) => item.id }));
jest.mock("@/utils/log", () => ({ trace: jest.fn(), errorLog: jest.fn() }));
jest.mock("react-native-background-timer", () => ({
    __esModule: true,
    default: { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: any) => clearTimeout(id) },
}));

const { MpvPlayerAdapter, RenditionTransitionFailure } = require("../mpvPlayerAdapter") as typeof import("../mpvPlayerAdapter");
import type { PlayerRenditionIdentity, PlayerRenditionRequest } from "../types";

const a = { id: "a", title: "Song A", url: "https://example.test/a.mp3", duration: 300 };
const b = { id: "b", title: "Song B", url: "https://example.test/b.mp3", duration: 200 };
const last = () => (mockNative.loadAndPlay.mock.calls as any[]).at(-1)[0];
const identity = (payload: any) => ({ mediaId: payload.mediaId, loadGeneration: payload.loadGeneration, renditionKind: payload.renditionKind ?? "audio" });
const confirmLoaded = () => mockEvents.active({ ...last(), ...identity(last()), source: "loaded" });
const ready = (position = last().startPosition ?? 0) => mockEvents.progress({ ...identity(last()), position, duration: 300, buffered: position, ready: true });
const confirm = () => {
    confirmLoaded();
    if (last().positionMode === "restore-audio") ready();
};
const video = (expected: PlayerRenditionIdentity): PlayerRenditionRequest => ({
    expected, kind: "mv", autoPlay: true,
    source: { url: "https://example.test/video.mp4" },
    video: { videoId: "clip", providerKey: "provider", timelineId: "cut1" },
    position: { mode: "start-zero" },
});

async function setup() {
    const adapter = new MpvPlayerAdapter();
    await adapter.setup();
    await adapter.loadQueue([a, b]);
    confirm();
    return adapter;
}
async function enter(adapter: import("../mpvPlayerAdapter").MpvPlayerAdapter) {
    const receipt = adapter.replaceRendition(video(adapter.getActiveRendition()!));
    confirm();
    return receipt;
}

beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockEvents)) delete mockEvents[key];
    mockNative.loadAndPlay.mockResolvedValue(37.25);
    mockNative.getPosition.mockResolvedValue(37.25);
    mockNative.getDuration.mockResolvedValue(300);
    mockNative.getRenditionProgress.mockResolvedValue(null);
});
afterEach(() => jest.useRealTimers());

test("actual adapter separates native audio capture from MV zero, queue URL and metadata", async () => {
    const adapter = await setup();
    const changed = jest.fn();
    adapter.addEventListener("trackChanged", changed);
    mockNative.updateMetadata.mockClear();
    const audio = adapter.getActiveRendition()!;
    const pending = adapter.replaceRendition(video(audio));
    expect(adapter.getActiveRendition()).toMatchObject(audio);
    expect(last()).toMatchObject({ url: "https://example.test/video.mp4", duration: 0, title: "Song A · MV", positionMode: "start-zero", playbackRate: 1, expectedLoadGeneration: audio.loadGeneration });
    expect(last()).not.toHaveProperty("preservePositionFallback");
    expect(last()).not.toHaveProperty("startPosition");
    confirm();
    const receipt = await pending;
    expect(receipt.outgoingPosition).toBe(37.25);
    expect(adapter.getActiveRendition()).toMatchObject({ kind: "mv", videoId: "clip" });
    expect(await adapter.getTrack(0)).toEqual(a);
    expect(await adapter.getActiveTrack()).toEqual(a);
    expect(changed).not.toHaveBeenCalled();
    expect(mockNative.updateMetadata).not.toHaveBeenCalled();
});

test("late original FILE_LOADED and wrong rendition kind cannot confirm or reload", async () => {
    const adapter = await setup();
    const audio = adapter.getActiveRendition()!;
    const pending = adapter.replaceRendition(video(audio));
    const target = last();
    mockEvents.active({ ...target, ...identity(target), renditionKind: "audio", source: "loaded" });
    mockEvents.active({ ...target, loadGeneration: audio.loadGeneration, renditionKind: "audio", source: "loaded" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockNative.stop).not.toHaveBeenCalled();
    expect(mockNative.loadAndPlay).toHaveBeenCalledTimes(2);
    confirm();
    await pending;
});

test("reorder during native loading commits the logical song's latest index", async () => {
    const adapter = await setup();
    const pending = adapter.replaceRendition(video(adapter.getActiveRendition()!));
    await adapter.addQueueTrack("default", { ...b, id: "new" }, 0);
    confirm();
    await pending;
    expect(await adapter.getActiveTrackIndex()).toBe(1);
    expect((await adapter.getActiveTrack())?.id).toBe("a");
});

test("late audio progress is rejected and an unknown MV duration stays unknown", async () => {
    const adapter = await setup();
    const old = last();
    await enter(adapter);
    mockEvents.progress({ ...identity(last()), position: 3, duration: 0, buffered: 4 });
    mockEvents.progress({ ...identity(old), position: 90, duration: 300 });
    mockEvents.progress({ position: 91, duration: 300 });
    expect(await adapter.getProgress()).toMatchObject({ position: 3, duration: 0 });
    await adapter.updateTrack({ ...a, title: "Updated original", duration: 999 });
    expect(mockNative.updateMetadata).toHaveBeenCalledTimes(1); // ordinary initial audio only
});

test("an audio getProgress promise cannot overwrite a later MV snapshot", async () => {
    const adapter = await setup();
    let release!: (value: number) => void;
    mockNative.getPosition.mockImplementationOnce(() => new Promise(resolve => {
        release = resolve; 
    }));
    const old = adapter.getProgress();
    await enter(adapter);
    mockEvents.progress({ ...identity(last()), position: 4, duration: 25, buffered: 5 });
    release(81);
    expect(await old).toMatchObject({ position: 4, duration: 25, buffered: 5 });
});

test("audio return uses explicit captured position and original rate, without trackChanged", async () => {
    const adapter = await setup();
    await adapter.setRate(1.5);
    await enter(adapter);
    const changed = jest.fn();
    adapter.addEventListener("trackChanged", changed);
    const pending = adapter.replaceRendition({ expected: adapter.getActiveRendition()!, kind: "audio", autoPlay: false, source: { url: a.url }, position: { mode: "restore-audio", positionSeconds: 37.25 } });
    expect(last()).toMatchObject({ renditionKind: "audio", positionMode: "restore-audio", startPosition: 37.25, autoPlay: false, playbackRate: 1.5, duration: 300 });
    expect(last()).not.toHaveProperty("preservePositionFallback");
    confirm(); await pending;
    expect(changed).not.toHaveBeenCalled();
    expect(await adapter.getRate()).toBe(1.5);
});

test("MV speed is session-local; audio preference is sent to native for the next song", async () => {
    const adapter = await setup(); await enter(adapter);
    mockNative.setRate.mockClear();
    await adapter.setRate(1.75);
    expect(await adapter.getRate()).toBe(1);
    expect(mockNative.setRate).toHaveBeenCalledWith(1.75);
});

test("a bounded activation timeout rejects with the exact attempted owner", async () => {
    jest.useFakeTimers();
    const adapter = await setup();
    const pending = adapter.replaceRendition(video(adapter.getActiveRendition()!));
    const outcome = pending.catch(error => error);
    await Promise.resolve();
    jest.advanceTimersByTime(15000);
    const error = await outcome;
    expect(error).toBeInstanceOf(RenditionTransitionFailure);
    expect(error.target).toMatchObject({ kind: "mv", loadGeneration: last().loadGeneration });
    expect(error.outgoingPosition).toBe(37.25);
    expect(mockNative.stop).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});

test("an owned native load failure rejects promptly while an older error is ignored", async () => {
    jest.useFakeTimers();
    const adapter = await setup();
    const old = adapter.getActiveRendition()!;
    const outcome = adapter.replaceRendition(video(old)).catch(error => error);
    await Promise.resolve();
    const target = last();
    let settled = false;
    outcome.then(() => {
        settled = true;
    });
    mockEvents.error({ mediaId: old.mediaId, loadGeneration: old.loadGeneration, renditionKind: "audio", code: "E_VIDEO_LOAD_FAILED" });
    await Promise.resolve();
    expect(settled).toBe(false);
    mockEvents.error({ ...identity(target), code: "E_VIDEO_LOAD_FAILED", message: "Video could not be loaded" });
    const error = await outcome;
    expect(error).toBeInstanceOf(RenditionTransitionFailure);
    expect(error.target).toMatchObject({ kind: "mv", loadGeneration: target.loadGeneration });
    expect(error.outgoingPosition).toBe(37.25);
    expect(jest.getTimerCount()).toBe(0);
    expect(mockNative.stop).not.toHaveBeenCalled();
});

test("a newer song cancels confirmation and the old MV cannot reappear", async () => {
    const adapter = await setup();
    const pending = adapter.replaceRendition(video(adapter.getActiveRendition()!)).catch(error => error);
    const old = last();
    await adapter.skipToIndex(1);
    confirm();
    mockEvents.active({ ...old, ...identity(old), source: "loaded" });
    expect(await pending).toBeInstanceOf(RenditionTransitionFailure);
    expect((await adapter.getActiveTrack())?.id).toBe("b");
    expect(adapter.getActiveRendition()?.kind).toBe("audio");
    expect(mockNative.stop).not.toHaveBeenCalled();
});

test("a declared matching timeline is required for preserve-MV", async () => {
    const adapter = await setup();await enter(adapter);
    const request = video(adapter.getActiveRendition()!);
    if (request.kind !== "mv") throw new Error("fixture");
    request.position = { mode: "preserve-mv", timelineId: "different-cut" };
    await expect(adapter.replaceRendition(request)).rejects.toThrow("timelines");
    expect(mockNative.loadAndPlay).toHaveBeenCalledTimes(2);
    request.position = { mode: "preserve-mv", timelineId: "cut1" };
    const pending = adapter.replaceRendition(request);confirm();await pending;
    expect(last().positionMode).toBe("preserve-mv");
});

test("prepared audio binds to the new MV source generation", async () => {
    const adapter = await setup();
    await adapter.prepareNextTrack(b);
    const old = (mockNative.prepareNext.mock.calls as any[]).at(-1)[0];
    await enter(adapter);
    await adapter.prepareNextTrack(b);
    const next = (mockNative.prepareNext.mock.calls as any[]).at(-1)[0];
    expect(next.sourceMediaId).toBe("a");
    expect(next.sourceLoadGeneration).toBe(adapter.getActiveRendition()!.loadGeneration);
    expect(next.sourceLoadGeneration).not.toBe(old.sourceLoadGeneration);
});

test("old and duplicate video EOF cannot advance the logical queue twice", async () => {
    const adapter = await setup();const original = adapter.getActiveRendition()!;
    await enter(adapter);const mv = adapter.getActiveRendition()!;const ended = jest.fn();
    adapter.addEventListener("playEnd", ended);
    mockEvents.ended({ reason: "end", endedMediaId: "a", endedLoadGeneration: original.loadGeneration, autoAdvanced: false });
    expect(ended).not.toHaveBeenCalled();
    const event = { reason: "end", endedMediaId: "a", endedLoadGeneration: mv.loadGeneration, endedRenditionKind: "mv", autoAdvanced: false };
    mockEvents.ended(event);mockEvents.ended(event);
    expect(ended).toHaveBeenCalledTimes(1);
});

test("native preflight rejection preserves a genuine prepared-audio promotion", async () => {
    const adapter = await setup();
    await adapter.prepareNextTrack(b);
    const prepared = (mockNative.prepareNext.mock.calls as any[]).at(-1)[0];
    let reject!: (error: Error & {code: string}) => void;
    mockNative.loadAndPlay.mockImplementationOnce(() => new Promise((_resolve, fail) => {
        reject = fail; 
    }));
    const pending = adapter.replaceRendition(video(adapter.getActiveRendition()!)).catch(error => error);
    mockEvents.active({ ...prepared, renditionKind: "audio", source: "prepared" });
    reject(Object.assign(new Error("preflight"), { code: "E_RENDITION_REJECTED" }));
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await adapter.getActiveTrack())?.id).toBe("b");
    expect(adapter.getActiveRendition()).toMatchObject({ kind: "audio", loadGeneration: prepared.loadGeneration });
    expect(mockNative.stop).not.toHaveBeenCalled();
});

test("a cancelled MV's late receipt cannot clear the new song's prepared audio", async () => {
    const adapter = await setup();
    let release!: (position: number) => void;
    mockNative.loadAndPlay.mockImplementationOnce(() => new Promise(resolve => {
        release = resolve; 
    }));
    const cancelled = adapter.replaceRendition(video(adapter.getActiveRendition()!)).catch(error => error);
    await adapter.skipToIndex(1);confirm();
    const c = { ...b, id: "c", title: "C" };
    await adapter.addQueueTrack("default", c);
    await adapter.prepareNextTrack(c);
    const prepared = (mockNative.prepareNext.mock.calls as any[]).at(-1)[0];
    release(37.25);await cancelled;
    await new Promise(resolve => setTimeout(resolve, 0));
    mockEvents.active({ ...prepared, renditionKind: "audio", source: "prepared" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await adapter.getActiveTrack())?.id).toBe("c");
    expect(mockNative.stop).not.toHaveBeenCalled();
});

test("native capture is delivered before activation, for immediate audio-checkpoint persistence", async () => {
    const adapter = await setup();
    const request = video(adapter.getActiveRendition()!);
    const captured = jest.fn();request.onScheduled = captured;
    const pending = adapter.replaceRendition(request);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ outgoingPosition: 37.25 }));
    expect(adapter.getActiveRendition()?.kind).toBe("audio");
    expect(adapter.getRenditionOwner()?.kind).toBe("mv");
    confirm();await pending;
});

test("extra runtime source/metadata fields cannot replace host identity or position policy", async () => {
    const adapter = await setup();
    const expected = adapter.getActiveRendition()!;
    const request = video(expected);
    Object.assign(request.source, { mediaId: "injected", loadGeneration: -1, startPosition: 90, preservePositionFallback: 90 });
    if (request.kind === "mv") Object.assign(request.video, { mediaId: "injected", loadGeneration: -1, kind: "audio" });
    const pending = adapter.replaceRendition(request);
    expect(last().mediaId).toBe(expected.mediaId);
    expect(last()).not.toHaveProperty("preservePositionFallback");
    expect(last()).not.toHaveProperty("startPosition");
    confirm();await pending;
    const publicValue = adapter.getActiveRendition()!;
    expect(publicValue).toMatchObject({ mediaId: expected.mediaId, kind: "mv" });
    publicValue.loadGeneration = -1;
    expect(adapter.getActiveRendition()!.loadGeneration).not.toBe(-1);
});


test("loaded and projected progress cannot release audio-return isolation before actual ready", async () => {
    const adapter = await setup(); await enter(adapter);
    let settled = false;
    const pending = adapter.replaceRendition({ expected: adapter.getRenditionOwner()!, kind: "audio", autoPlay: false,
        source: { url: a.url }, position: { mode: "restore-audio", positionSeconds: 37.25 } }).then(() => {
        settled = true;
    });
    confirmLoaded();
    mockEvents.progress({ ...identity(last()), position: 37.25, duration: 300, ready: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    ready(37.25); await pending;
    expect(settled).toBe(true);
});

test("the first real ready audio clock below the checkpoint is rejected even if a later clock catches up", async () => {
    const adapter = await setup(); await enter(adapter);
    const pending = adapter.replaceRendition({ expected: adapter.getRenditionOwner()!, kind: "audio", autoPlay: false,
        source: { url: a.url }, position: { mode: "restore-audio", positionSeconds: 37.25 } }).catch(error => error);
    confirmLoaded(); ready(36.99); ready(37.25);
    expect(await pending).toBeInstanceOf(RenditionTransitionFailure);
});


test("a native synchronous rollback reconciles the old owner and actual stopped checkpoint", async () => {
    const adapter = await setup(); const old = adapter.getRenditionOwner()!;
    mockNative.loadAndPlay.mockRejectedValueOnce(Object.assign(new Error("native command"), { code: "E_RENDITION_ROLLED_BACK",
        userInfo: { mediaId: old.mediaId, loadGeneration: old.loadGeneration, outgoingAudioPosition: 37.5 } }));
    const error = await adapter.replaceRendition(video(old)).catch(value => value);
    expect(error).toMatchObject({ rolledBack: true, outgoingPosition: 37.5, rejectedBeforeMutation: false });
    expect(adapter.getRenditionOwner()).toEqual(old);
    expect(mockNative.stop).not.toHaveBeenCalled();
});

test("the audio return receipt preserves the exact passing ready sample instead of rereading the player", async () => {
    const adapter = await setup(); await enter(adapter);
    const pending = adapter.replaceRendition({ expected: adapter.getRenditionOwner()!, kind: "audio", autoPlay: false,
        source: { url: a.url }, position: { mode: "restore-audio", positionSeconds: 37.25 } });
    confirmLoaded(); ready(37.25);
    mockEvents.progress({ ...identity(last()), position: 38.5, duration: 300, buffered: 40, ready: true });
    const receipt = await pending;
    expect(receipt.readyProgress).toMatchObject({ position: 37.25, ready: true });
    expect(mockNative.getRenditionProgress).not.toHaveBeenCalled();
});


test("an owned remote-song handler prevents a second direct adapter source mutation", async () => {
    const adapter = await setup(); await enter(adapter);
    const handler = jest.fn(() => true); adapter.addEventListener("remotePlayFromId", handler);
    const loaded = mockNative.loadAndPlay.mock.calls.length;
    mockEvents.remote({ command: "playFromId", mediaId: "b" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "b" }));
    expect(mockNative.loadAndPlay).toHaveBeenCalledTimes(loaded);
});
