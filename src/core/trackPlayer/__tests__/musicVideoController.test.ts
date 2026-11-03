import MusicVideoController from "../musicVideoController";
import QualityChangeCoordinator from "../qualityChangeCoordinator";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import type { PlayerActiveRendition, PlayerRenditionRequest } from "@/core/playerAdapter/types";
import type { MusicVideoCandidate } from "@/core/pluginManager/musicVideoSource";

const song = { id: "a", platform: "p", title: "A", artist: "Artist" } as IMusic.IMusicItem;
const key = getMediaUniqueKey(song);
const clip = (id = "clip"): MusicVideoCandidate => ({ id, title: id, originalSongKey: key,
    providerKey: "p", providerName: "Provider", qualities: [{ id: "720p", label: "720p" }] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a; reject = b;
    });
    return { promise, resolve, reject };
}
function fixture(wasPlaying = true) {
    let currentSong: IMusic.IMusicItem | null = song;
    let foreground = true, allowed = wasPlaying;
    let generation = 1;
    let owner: PlayerActiveRendition = { kind: "audio", mediaId: key, loadGeneration: generation };
    let active = owner;
    const coordinator = new QualityChangeCoordinator();
    const resolved = (candidate = clip(), current = () => true) => ({ candidate,
        source: { url: "https://example.test/video.mp4", timelineId: "same-cut" }, quality: "720p", isCurrent: current });
    const sources = { supports: jest.fn(() => true), find: jest.fn(async () => [clip()]),
        resolve: jest.fn(async (candidate: MusicVideoCandidate, _quality: unknown, current: () => boolean) => resolved(candidate, current)) };
    const deps = {
        sources, coordinator,
        currentSong: () => currentSong, owner: () => owner, active: () => active,
        foreground: () => foreground, repeatCurrentVideo: () => true,
        audioSettings: () => ({ quality: "standard" as IMusic.IQualityKey, rate: 1.5, wasPlaying }),
        mayAutoPlay: () => allowed,
        claimPlayback: jest.fn(async () => {
            allowed = true;
        }),
        resumeAudio: jest.fn(async () => undefined),
        resumeVideo: jest.fn(async (_policy: unknown) => undefined),
        videoNetwork: jest.fn(async (): Promise<"unmetered" | "allow-metered"> => "unmetered"),
        admitVideo: async (source: IPlugin.IVideoSourceResult) => ({ url: source.url! }),
        resolveAudio: jest.fn(async () => ({ url: "https://example.test/original.mp3" })),
        replace: jest.fn(async (request: PlayerRenditionRequest) => {
            if (request.expected.mediaId !== owner.mediaId || request.expected.loadGeneration !== owner.loadGeneration) {
                throw Object.assign(new Error("preflight"), { rejectedBeforeMutation: true });
            }
            owner = { mediaId: key, loadGeneration: ++generation, kind: request.kind,
                ...(request.kind === "mv" ? request.video : {}) };
            const receipt = { rendition: owner, outgoingPosition: request.expected.kind === "audio" ? 37.125 : 9, readyProgress: request.kind === "audio" ? { position: 37.125, duration: 300, buffered: 37.125, ready: true } : undefined };
            request.onScheduled?.(receipt);active = owner;return receipt;
        }),
        cancelNativeWait: jest.fn(),
        videoInfo: jest.fn(async () => ({ mediaId: owner.mediaId, loadGeneration: owner.loadGeneration,
            kind: owner.kind, outgoingAudioPosition: owner.kind === "mv" ? 37.125 : undefined })),
        publish: jest.fn(), timelineChanged: jest.fn(), saveAudioCheckpoint: jest.fn(),
        audioReturned: jest.fn(async (_checkpoint: unknown): Promise<void> => undefined), videoActivated: jest.fn(),
    };
    const controller = new MusicVideoController(deps);
    return { deps, controller, sources, coordinator, resolved,
        setSong: (value: IMusic.IMusicItem | null) => {
            currentSong = value;
        },
        setForeground: (value: boolean) => {
            foreground = value;
        },
        pause: () => {
            allowed = false;
        },
    };
}

test("browsing candidates does not supersede the existing audio quality request", async () => {
    const f = fixture();const old = f.coordinator.begin();
    expect(await f.controller.candidates()).toHaveLength(1);
    expect(f.coordinator.isActive(old)).toBe(true);
    expect(f.deps.claimPlayback).not.toHaveBeenCalled();
    expect(f.deps.replace).not.toHaveBeenCalled();
});

test("watch uses the shared coordinator, native checkpoint and a URL-free UI state", async () => {
    const f = fixture();const old = f.coordinator.begin();
    expect(await f.controller.enter(clip())).toEqual({ status: "playing" });
    expect(f.coordinator.isActive(old)).toBe(false);
    expect(f.deps.saveAudioCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ songKey: key, positionSeconds: 37.125, sourceGeneration: 1, rate: 1.5 }));
    expect(f.deps.replace.mock.calls[0][0]).toMatchObject({ position: { mode: "start-zero" }, autoPlay: true });
    expect(f.controller.blocksAudioTimeline).toBe(true);
    expect(JSON.stringify(f.controller.snapshot)).not.toContain("https:");
    expect(JSON.stringify(f.controller.checkpoint)).not.toContain("https:");
});

test.each([true, false])("return preserves original playing=%p", async wasPlaying => {
    const f = fixture(wasPlaying);await f.controller.enter(clip());
    expect(await f.controller.returnToAudio()).toEqual({ status: "audio" });
    expect(f.deps.replace.mock.calls[1][0]).toMatchObject({ kind: "audio", autoPlay: wasPlaying,
        position: { mode: "restore-audio", positionSeconds: 37.125 } });
    expect(f.controller.checkpoint).toBeNull();
    expect(f.controller.blocksAudioTimeline).toBe(false);
});

test("user pause during source resolution is not cleared by late source completion", async () => {
    const f = fixture();const source = deferred<ReturnType<typeof f.resolved>>();
    f.sources.resolve.mockReturnValueOnce(source.promise);
    const pending = f.controller.enter(clip());await tick();f.pause();source.resolve(f.resolved());
    await pending;
    expect(f.deps.claimPlayback).toHaveBeenCalledTimes(1);
    expect(f.deps.replace.mock.calls[0][0].autoPlay).toBe(false);
    await f.controller.returnToAudio();
    expect(f.deps.replace.mock.calls[1][0].autoPlay).toBe(false);
});

test("late MV1 cannot replace the MV2 selected while it was resolving", async () => {
    const f = fixture();const source = deferred<ReturnType<typeof f.resolved>>();
    f.sources.resolve.mockReturnValueOnce(source.promise);
    const first = f.controller.enter(clip("first"));await tick();
    await f.controller.enter(clip("second"));source.resolve(f.resolved(clip("first")));
    expect(await first).toEqual({ status: "cancelled" });
    expect(f.deps.replace).toHaveBeenCalledTimes(1);
    expect(f.controller.snapshot).toMatchObject({ phase: "video", video: { id: "second" } });
});

test("selecting song B prevents a late request from restoring song A", async () => {
    const f = fixture();const source = deferred<ReturnType<typeof f.resolved>>();
    f.sources.resolve.mockReturnValueOnce(source.promise);
    const first = f.controller.enter(clip());await tick();
    f.controller.leaveForSongChange();f.setSong({ ...song, id: "b" });source.resolve(f.resolved());
    expect(await first).toEqual({ status: "cancelled" });
    expect(f.deps.replace).not.toHaveBeenCalled();expect(f.deps.saveAudioCheckpoint).not.toHaveBeenCalled();
});

test.each(["network", "source"])("%s failure before native commit leaves real audio consumers running", async stage => {
    const f = fixture();
    if (stage === "network") f.deps.videoNetwork.mockRejectedValueOnce(new Error("network"));
    else f.sources.resolve.mockRejectedValueOnce(new Error("source"));
    expect(await f.controller.enter(clip())).toEqual({ status: "error", error: stage });
    expect(f.deps.timelineChanged).not.toHaveBeenCalled();expect(f.deps.replace).not.toHaveBeenCalled();
    expect(f.controller.snapshot).toMatchObject({ phase: "audio" });
});

test("plugin invalidation cannot leave an infinite resolving UI", async () => {
    const f = fixture();f.sources.resolve.mockResolvedValueOnce(f.resolved(clip(), () => false));
    expect(await f.controller.enter(clip())).toEqual({ status: "cancelled" });
    expect(f.controller.snapshot.phase).toBe("audio");expect(f.deps.replace).not.toHaveBeenCalled();
});

test("native preflight rejection does not issue a destructive audio rollback", async () => {
    const f = fixture();f.deps.replace.mockRejectedValueOnce(Object.assign(new Error("preflight"), { rejectedBeforeMutation: true }));
    expect(await f.controller.enter(clip())).toEqual({ status: "error", error: "activation" });
    expect(f.deps.replace).toHaveBeenCalledTimes(1);expect(f.deps.resolveAudio).not.toHaveBeenCalled();
    expect(f.controller.snapshot.phase).toBe("audio");expect(f.controller.blocksAudioTimeline).toBe(false);
});

test("a changed quality timeline requires confirmation and leaves the current MV untouched", async () => {
    const f = fixture();await f.controller.enter(clip());
    const changed = f.resolved();changed.source.timelineId = "another-cut";
    f.sources.resolve.mockResolvedValueOnce(changed);
    expect(await f.controller.changeQuality("720p")).toEqual({ status: "restart-confirmation" });
    expect(f.deps.replace).toHaveBeenCalledTimes(1);expect(f.controller.snapshot.phase).toBe("video");
    f.sources.resolve.mockResolvedValueOnce(changed);
    await f.controller.changeQuality("720p", true);
    expect(f.deps.replace.mock.calls[1][0].position.mode).toBe("start-zero");
    expect(f.deps.saveAudioCheckpoint).toHaveBeenCalledTimes(1);
});

test("declared same-cut quality uses preserve-MV without replacing the audio checkpoint", async () => {
    const f = fixture();await f.controller.enter(clip());await f.controller.changeQuality("720p");
    expect(f.deps.replace.mock.calls[1][0].position).toEqual({ mode: "preserve-mv", timelineId: "same-cut" });
    expect(f.deps.saveAudioCheckpoint).toHaveBeenCalledTimes(1);expect(f.controller.checkpoint?.positionSeconds).toBe(37.125);
});

test("background cancels a resolving entry while retaining the original audio", async () => {
    const f = fixture();const source = deferred<ReturnType<typeof f.resolved>>();
    f.sources.resolve.mockReturnValueOnce(source.promise);
    const pending = f.controller.enter(clip());await tick();f.setForeground(false);f.controller.onBackground();source.resolve(f.resolved());
    expect(await pending).toEqual({ status: "cancelled" });
    expect(f.controller.snapshot.phase).toBe("audio");expect(f.deps.replace).not.toHaveBeenCalled();
});

test("audio consumers stay blocked until the return hydration completes", async () => {
    const f = fixture();await f.controller.enter(clip());const hydration = deferred<void>();
    f.deps.audioReturned.mockReturnValueOnce(hydration.promise);
    const pending = f.controller.returnToAudio();await tick();
    expect(f.controller.snapshot.phase).toBe("returning");expect(f.controller.blocksAudioTimeline).toBe(true);
    expect(f.controller.checkpoint?.positionSeconds).toBe(37.125);hydration.resolve();await pending;
    expect(f.controller.snapshot.phase).toBe("audio");
});

test("a failed audio return retains its native checkpoint for explicit retry", async () => {
    const f = fixture();await f.controller.enter(clip());
    f.deps.replace.mockRejectedValueOnce(new Error("return failed"));
    expect(await f.controller.returnToAudio()).toEqual({ status: "error", error: "audio-return" });
    expect(f.controller.checkpoint?.positionSeconds).toBe(37.125);
    expect(f.controller.snapshot.phase).toBe("error");
    expect(await f.controller.returnToAudio()).toEqual({ status: "audio" });
});

test("explicitly choosing original audio can play even if it was initially paused", async () => {
    const f = fixture(false);await f.controller.enter(clip());await f.controller.returnToAudio(true);
    expect(f.deps.replace.mock.calls[1][0].autoPlay).toBe(true);
});

test("deliberate repeat of the existing MV may run as background audio", async () => {
    const f = fixture();await f.controller.enter(clip());f.setForeground(false);
    expect(await f.controller.replay()).toEqual({ status: "playing" });
    expect(f.deps.claimPlayback).toHaveBeenCalledTimes(1);
    expect(f.deps.saveAudioCheckpoint).toHaveBeenCalledTimes(1);
});

test("a fresh network denial on MV resume is visible and never resumes the native player", async () => {
    const f = fixture(); await f.controller.enter(clip());
    f.deps.videoNetwork.mockRejectedValueOnce(new Error("metered"));
    expect(await f.controller.resume()).toEqual({ status: "error", error: "network" });
    expect(f.deps.resumeVideo).not.toHaveBeenCalled();
    expect(f.controller.snapshot).toMatchObject({ phase: "video", error: "network" });
});
test("a pause while resume checks fresh network remains stronger than a late approval", async () => {
    const f = fixture(); await f.controller.enter(clip());
    const network = deferred<"unmetered">(); f.deps.videoNetwork.mockReturnValueOnce(network.promise);
    const pending = f.controller.resume(); await tick(); f.pause(); network.resolve("unmetered"); await pending;
    expect(f.deps.resumeVideo).not.toHaveBeenCalled();
});


test("explicit play while returning from an originally paused song resumes only after actual audio readiness", async () => {
    const f = fixture(false); await f.controller.enter(clip());
    const ready = deferred<void>();
    const replace = f.deps.replace.getMockImplementation()!;
    f.deps.replace.mockImplementationOnce(async request => {
        const result = await replace(request); await ready.promise; return result;
    });
    const returning = f.controller.returnToAudio(); await tick();
    f.controller.playPendingReturn();
    expect(f.deps.resumeAudio).not.toHaveBeenCalled();
    ready.resolve(undefined);
    await returning;
    expect(f.deps.resumeAudio).toHaveBeenCalledTimes(1);
});
