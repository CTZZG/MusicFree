const mockEvents: Record<string, (event: any) => void> = {};
const mockNative = {
    isAvailable: () => true,
    initialize: jest.fn(async () => undefined),
    isAndroidAutoConnected: jest.fn(async () => false),
    loadAndPlay: jest.fn(async (): Promise<number | null> => 37.25),
    prepareNext: jest.fn(async () => undefined), prepareNextBatch: jest.fn(async () => undefined),
    updateQueueSnapshot: jest.fn(async () => undefined), updateMetadata: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined), pause: jest.fn(async () => undefined), resume: jest.fn(async () => undefined),
    setRate: jest.fn(async () => undefined),
    getPosition: jest.fn(async () => 37.25), getDuration: jest.fn(async () => 300),
    getRenditionProgress: jest.fn(async (): Promise<any> => null),
    getVideoInfo: jest.fn(async (): Promise<any> => null),
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
    addAndroidAutoConnectionChangedListener: () => undefined, addBrowseRequestListener: () => undefined,
};
jest.mock("@/core/playerAdapter/nativeMpvPlayer", () => ({ __esModule: true, default: mockNative }));
jest.mock("@/utils/mediaUtils", () => ({ getMediaUniqueKey: (item: any) => item.id }));
jest.mock("@/utils/mediaIdentity", () => ({ getMediaUniqueKey: (item: any) => item.id }));
jest.mock("@/utils/log", () => ({ trace: jest.fn(), errorLog: jest.fn() }));
jest.mock("react-native-background-timer", () => ({ __esModule: true,
    default: { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: any) => clearTimeout(id) } }));
const { MpvPlayerAdapter } = require("@/core/playerAdapter/mpvPlayerAdapter") as typeof import("@/core/playerAdapter/mpvPlayerAdapter");
const MusicVideoController = require("../musicVideoController").default as typeof import("../musicVideoController").default;
const QualityChangeCoordinator = require("../qualityChangeCoordinator").default as typeof import("../qualityChangeCoordinator").default;
const a = { id: "a", platform: "p", title: "A", url: "https://example.test/a.mp3", duration: 300 } as any;
const b = { ...a, id: "b", title: "B", duration: 200 };
const candidate = { id: "clip", title: "Clip", originalSongKey: "a", providerKey: "p", providerName: "P",
    qualities: [{ id: "720p", label: "720p" }] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const last = () => (mockNative.loadAndPlay.mock.calls as any[]).at(-1)[0];
const identity = (payload: any) => ({ mediaId: payload.mediaId, loadGeneration: payload.loadGeneration,
    renditionKind: payload.renditionKind ?? "audio" });
const loaded = (payload = last()) => mockEvents.active({ ...payload, ...identity(payload), source: "loaded" });
const progress = (position: number, payload = last()) => mockEvents.progress({ ...identity(payload),
    position, duration: payload.renditionKind === "mv" ? 180 : payload.duration, buffered: position, ready: true });
function request(adapter: InstanceType<typeof MpvPlayerAdapter>): import("@/core/playerAdapter/types").PlayerRenditionRequest {
    return { expected: adapter.getRenditionOwner()!, kind: "mv", autoPlay: true,
        source: { url: "https://example.test/v.mp4" }, video: { videoId: "clip", providerKey: "p", timelineId: "cut" },
        position: { mode: "start-zero" } };
}
async function setup() {
    const adapter = new MpvPlayerAdapter(); await adapter.setup(); await adapter.loadQueue([a, b]); loaded();
    return adapter;
}
function controllerFor(adapter: InstanceType<typeof MpvPlayerAdapter>) {
    const resolveAudio = jest.fn(async () => ({ url: a.url }));
    const videoActivated = jest.fn();
    const controller = new MusicVideoController({
        sources: { supports: () => true, find: async () => [],
            resolve: async (clip: any, quality: any, current: any) => ({ candidate: clip, quality: quality ?? "720p",
                isCurrent: current, source: { url: "https://example.test/v.mp4", timelineId: "cut" } }) },
        coordinator: new QualityChangeCoordinator(), currentSong: () => a,
        owner: () => adapter.getRenditionOwner(), active: () => adapter.getActiveRendition(), foreground: () => true,
        audioSettings: () => ({ quality: "standard" as any, rate: 1, wasPlaying: true }),
        mayAutoPlay: () => true, repeatCurrentVideo: () => false, claimPlayback: async () => undefined,
        videoNetwork: async () => "unmetered", resumeVideo: async () => undefined, resumeAudio: async () => undefined,
        admitVideo: async (source: any) => ({ url: source.url }), resolveAudio,
        replace: req => adapter.replaceRendition(req), cancelNativeWait: () => adapter.cancelRenditionTransition(),
        waitForNativeScheduling: () => adapter.waitForRenditionScheduling(), videoInfo: () => adapter.getVideoInfo(),
        publish: () => undefined, timelineChanged: () => undefined, saveAudioCheckpoint: () => undefined,
        audioReturned: async () => undefined, videoActivated,
    });
    adapter.addEventListener("playbackError", () => {
        controller.handlePlaybackError().catch(() => undefined);
    });
    adapter.addEventListener("videoNetworkBlocked", owner => controller.handleNetworkBlocked(owner));
    return { controller, resolveAudio, videoActivated };
}
beforeEach(() => {
    jest.clearAllMocks(); for (const key of Object.keys(mockEvents)) delete mockEvents[key];
    mockNative.loadAndPlay.mockReset().mockResolvedValue(37.25);
    mockNative.getRenditionProgress.mockReset().mockResolvedValue(null);
    mockNative.getVideoInfo.mockReset().mockResolvedValue(null);
});

test("loaded followed by a file error before scheduling settles cannot publish a successful MV", async () => {
    const adapter = await setup(); const f = controllerFor(adapter);
    let resolveLoad!: (value: number) => void;
    mockNative.loadAndPlay.mockImplementationOnce(() => new Promise<number>(resolve => {
        resolveLoad = resolve;
    }));
    const entering = f.controller.enter(candidate); await tick();
    const mv = last(); loaded(mv);
    mockEvents.error({ ...identity(mv), code: "E_MPV_FILE_END", mpvError: -13, message: "failed" });
    resolveLoad(37.25); await tick(); await tick();
    const recovered = f.resolveAudio.mock.calls.length;
    if (recovered) {
        loaded(); progress(37.25);
    }
    const result = await entering;
    expect(recovered).toBe(1);
    expect(result).toMatchObject({ status: "error" });
    expect(f.controller.snapshot.phase).toBe("audio");
    expect(f.videoActivated).not.toHaveBeenCalled();
});

test("a first-frame watchdog or later playback error cannot undo network suspension", async () => {
    const adapter = await setup(); const f = controllerFor(adapter);
    mockNative.getVideoInfo.mockImplementation(async () => ({ ...adapter.getRenditionOwner()!, kind: "mv",
        suspended: true, suspendedPositionAvailable: true, outgoingAudioPosition: 37.25 }));
    const entering = f.controller.enter(candidate); await tick();
    mockEvents.error({ ...identity(last()), code: "E_VIDEO_NETWORK_BLOCKED", message: "suspended" });
    await entering;
    const failure = f.controller.handlePlaybackError(); await tick();
    const audioRequests = f.resolveAudio.mock.calls.length;
    if (audioRequests) {
        loaded(); progress(37.25);
    }
    await failure;
    expect(audioRequests).toBe(0);
    expect(f.controller.snapshot).toMatchObject({ phase: "video", error: "network" });
});

test("a prepared promotion survives cancellation before a late native preflight rejection", async () => {
    const adapter = await setup(); await adapter.prepareNextTrack(b);
    const prepared = (mockNative.prepareNext.mock.calls as any[]).at(-1)[0];
    let rejectLoad!: (error: Error) => void;
    mockNative.loadAndPlay.mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectLoad = reject;
    }));
    const attempted = adapter.replaceRendition(request(adapter)).catch(error => error);
    mockEvents.active({ ...prepared, renditionKind: "audio", source: "prepared" });
    adapter.cancelRenditionTransition(); await attempted;
    mockNative.getRenditionProgress.mockResolvedValue({ ...prepared, renditionKind: "audio", position: 5,
        duration: 200, buffered: 10, ready: true });
    rejectLoad(Object.assign(new Error("rejected"), { code: "E_RENDITION_REJECTED",
        userInfo: { mediaId: prepared.mediaId, loadGeneration: prepared.loadGeneration } }));
    await adapter.waitForRenditionScheduling(); await tick();
    expect(adapter.getRenditionOwner()).toMatchObject({ mediaId: "b", kind: "audio" });
    expect(adapter.getActiveRendition()).toMatchObject({ mediaId: "b", ready: true });
    const observed = jest.fn(); adapter.addEventListener("progress", observed);
    progress(15, prepared); expect(observed).toHaveBeenCalled();
});

test("generic play cannot synthesize EOF for a network-suspended MV near its end", async () => {
    const adapter = await setup(); const entering = adapter.replaceRendition(request(adapter)); loaded(); await entering;
    const mv = last(); progress(179.5, mv);
    mockEvents.error({ ...identity(mv), code: "E_VIDEO_NETWORK_BLOCKED", message: "suspended" });
    mockNative.getVideoInfo.mockResolvedValue({ ...identity(mv), kind: "mv", suspended: true });
    mockNative.getRenditionProgress.mockResolvedValue({ ...identity(mv), position: 179.5, duration: 180, ready: false });
    const ended = jest.fn(); adapter.addEventListener("playEnd", ended);
    await adapter.play(); expect(ended).not.toHaveBeenCalled();
});

test("an older load receipt cannot erase the new song's ready clock", async () => {
    const adapter = await setup();
    mockNative.loadAndPlay.mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: "E_RENDITION_REJECTED" }));
    await adapter.replaceRendition(request(adapter)).catch(() => undefined);
    let finishOld!: (value: null) => void;
    mockNative.loadAndPlay.mockImplementationOnce(() => new Promise<null>(resolve => {
        finishOld = resolve;
    }));
    const old = adapter.skipToIndex(0); await tick();
    await adapter.skipToIndex(1); loaded(); progress(12);
    finishOld(null); await old;
    expect(adapter.getActiveRendition()).toMatchObject({ mediaId: "b", ready: true });
    expect(await adapter.getProgress()).toMatchObject({ position: 12, ready: true });
});

test("an idle audio core reloads through the adapter with fresh identity and original request options", async () => {
    const adapter = new MpvPlayerAdapter(); await adapter.setup();
    await adapter.loadQueue([{ ...a, headers: { "X-Track": "A" }, userAgent: "agent-A" }, b]); loaded();
    const old = last();
    await adapter.prepareNextTrack({ ...b, headers: { "X-Track": "B" }, userAgent: "agent-B" });
    mockNative.resume.mockRejectedValueOnce(Object.assign(new Error("reload"), { code: "E_MPV_RELOAD_REQUIRED" }));
    await adapter.play();
    expect(last()).toMatchObject({ mediaId: "a", headers: { "X-Track": "A" }, userAgent: "agent-A" });
    expect(last().loadGeneration).toBeGreaterThan(old.loadGeneration);
});

test("ended or errored audio clears ready and quality refresh rejection does not commit quality", async () => {
    const { commitQualitySourcePair } = require("../qualityChangeCoordinator") as typeof import("../qualityChangeCoordinator");
    const adapter = await setup();
    const audioLoad = last();
    mockNative.loadAndPlay.mockRejectedValueOnce(Object.assign(new Error("rejected"), {
        code: "E_RENDITION_REJECTED",
        userInfo: { mediaId: audioLoad.mediaId, loadGeneration: audioLoad.loadGeneration },
    }));
    mockNative.getRenditionProgress.mockResolvedValueOnce({
        ...identity(audioLoad), position: 37.25, duration: 300, buffered: 50, ready: true,
    });
    await adapter.replaceRendition(request(adapter)).catch(() => undefined);
    expect(adapter.getActiveRendition()?.ready).toBe(true);

    mockEvents.ended({
        reason: "end", autoAdvanced: false,
        endedMediaId: audioLoad.mediaId, endedLoadGeneration: audioLoad.loadGeneration, endedRenditionKind: "audio",
    });
    await tick();
    expect(adapter.getActiveRendition()?.ready).toBe(false);

    mockNative.loadAndPlay.mockRejectedValueOnce(Object.assign(new Error("outgoing audio clock is not ready"), { code: "E_LOAD" }));
    const applyQuality = jest.fn();
    await expect(commitQualitySourcePair({
        resumePosition: 37.25,
        applySource: async pos => {
            await adapter.loadQueue([{ ...a, url: "https://example.test/a-flac.flac" }], 0, {
                autoPlay: false, preservePositionFallback: pos,
            });
        },
        isTargetCurrent: () => true,
        isRequestActive: () => true,
        applyQuality,
    })).rejects.toMatchObject({ code: "E_LOAD" });
    expect(applyQuality).not.toHaveBeenCalled();
});
