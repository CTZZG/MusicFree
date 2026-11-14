jest.mock("react-native-reanimated", () => ({
    cancelAnimation: jest.fn(), Easing: { linear: jest.fn() },
    makeMutable: jest.fn(() => ({ value: 0 })), withTiming: (value: number) => value,
}));
jest.mock("@/utils/log", () => ({ errorLog: jest.fn(), trace: jest.fn(), devLog: jest.fn() }));
jest.mock("@/utils/mediaExtra", () => ({ getMediaExtraProperty: jest.fn(), patchMediaExtra: jest.fn() }));
jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: (item: { platform: string; id: string }) => `${item.platform}@${item.id}`,
    isSameMediaItem: (a: any, b: any) => a?.id === b?.id && a?.platform === b?.platform,
}));
jest.mock("@/utils/persistStatus", () => ({ __esModule: true, default: { get: jest.fn(), set: jest.fn() } }));
jest.mock("@/utils/fileUtils", () => ({ checkAndCreateDir: jest.fn().mockResolvedValue(undefined) }));
jest.mock("react-native-fs", () => ({ unlink: jest.fn(), writeFile: jest.fn() }));
jest.mock("@/native/lyricUtil", () => ({ __esModule: true, default: {
    setActivePlayerBackend: jest.fn().mockResolvedValue(undefined),
    showStatusBarLyric: jest.fn().mockResolvedValue(undefined),
    setStatusBarLyricText: jest.fn().mockResolvedValue(undefined),
    setStatusBarLyricPayload: jest.fn().mockResolvedValue(undefined),
    clearMediaNotificationLyricText: jest.fn().mockResolvedValue(undefined),
    clearLiveUpdateLyricText: jest.fn().mockResolvedValue(undefined),
} }));

import lyricManager from "../lyricManager";
import { TrackPlayerEvents } from "@/constants/trackPlayerConst";

const song = (id: string) => ({ id, platform: "test", title: id, artist: "Artist" });
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
async function setup(getLyric: jest.Mock) {
    const listeners = new Map<string, () => void>();
    const player: any = {
        currentMusic: null, audioTimelineAvailable: true,
        videoOwnsPlayback: false, videoOwnershipRevision: 0,
        on: (event: string, fn: () => void) => listeners.set(event, fn),
        off: (event: string) => listeners.delete(event),
        isCurrentMusic: (item: any) => item?.id === player.currentMusic?.id && item?.platform === player.currentMusic?.platform,
        playerAdapter: { name: "mpv", getState: async () => "paused", addEventListener: () => ({ remove: jest.fn() }) },
        getProgress: jest.fn(async () => ({ position: 15, duration: 300, buffered: 15 })),
        getProgressSnapshot: jest.fn(() => ({ mediaKey: player.currentMusic ? `test@${player.currentMusic.id}` : null,
            position: 15, duration: 300, buffered: 15, sequence: 1 })),
    };
    const plugin = { name: "test", methods: { getLyric }, supportedMethods: new Set(["getLyric"]) };
    lyricManager.dispose();
    lyricManager.injectDependencies(player, { getConfig: () => undefined } as any,
        { getByMedia: () => plugin, getSearchablePlugins: () => [] } as any);
    await lyricManager.setup();
    player.getProgress.mockClear();
    return { player, fire: (event: string) => listeners.get(event)?.() };
}

afterEach(() => lyricManager.dispose());

it("fetches the new song before its audio is ready without reading the old clock", async () => {
    const result = deferred<any>();
    const getLyric = jest.fn(() => result.promise);
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("B");
    player.audioTimelineAvailable = false;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    expect(getLyric).toHaveBeenCalledTimes(1);
    expect(lyricManager.lyricState.loading).toBe(true);
    expect(player.getProgress).not.toHaveBeenCalled();
    fire(TrackPlayerEvents.CurrentMusicChanged);
    expect(getLyric).toHaveBeenCalledTimes(1);
    result.resolve({ rawLrc: "[00:00.00]Beginning\n[00:10.00]Later" });
    await settle();
    expect(lyricManager.lyricState.lyrics).toHaveLength(2);
    expect(lyricManager.currentLyricItem).toBeNull();
    expect(lyricManager.getLyricDiagnosticSnapshot().nativeOutput.text).toBe("");
    expect(player.getProgress).not.toHaveBeenCalled();
    player.audioTimelineAvailable = true;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    expect(getLyric).toHaveBeenCalledTimes(1);
    expect(player.getProgress).toHaveBeenCalled();
    expect(lyricManager.currentLyricItem?.index).toBe(1);
});

it("does not duplicate an in-flight request when audio becomes ready", async () => {
    const result = deferred<any>();
    const getLyric = jest.fn(() => result.promise);
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("C"); player.audioTimelineAvailable = false;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    player.audioTimelineAvailable = true;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    fire(TrackPlayerEvents.AudioTimelineChanged);
    expect(getLyric).toHaveBeenCalledTimes(1);
    result.resolve({ rawLrc: "[00:00.00]B lyric" });
    await settle();
    expect(lyricManager.lyricState.lyrics).toHaveLength(1);
});

it("retries a completed empty lookup on a later same-song commit", async () => {
    const getLyric = jest.fn(async () => null);
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("A");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    expect(getLyric).toHaveBeenCalledTimes(1);
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    expect(getLyric).toHaveBeenCalledTimes(2);
});

it("retries a completed failed lookup on a later same-song commit", async () => {
    const getLyric = jest.fn().mockRejectedValueOnce(new Error("plugin unavailable"))
        .mockResolvedValueOnce({ rawLrc: "[00:00.00]Retry succeeded" });
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("retry");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    expect(lyricManager.lyricState.emptyReason).toBe("parse-failed");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    expect(getLyric).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).toContain("Retry succeeded");
});

it("discards a previous song's late result", async () => {
    const late = deferred<any>();
    const getLyric = jest.fn().mockImplementationOnce(() => late.promise)
        .mockResolvedValueOnce({ rawLrc: "[00:00.00]Song C" });
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("B"); player.audioTimelineAvailable = false;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    player.currentMusic = song("C");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    await settle();
    late.resolve({ rawLrc: "[00:00.00]Stale B" });
    await settle();
    expect(lyricManager.lyricState.lyrics).toHaveLength(1);
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).toContain("Song C");
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).not.toContain("Stale B");
});

it("rejects a pending lyric result if MV takes ownership while audio is already unready", async () => {
    const late = deferred<any>();
    const getLyric = jest.fn().mockImplementationOnce(() => late.promise)
        .mockResolvedValueOnce({ rawLrc: "[00:00.00]Restored" });
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("B"); player.audioTimelineAvailable = false;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    player.videoOwnsPlayback = true; player.videoOwnershipRevision += 1;
    fire("music-video-ownership-changed");
    late.resolve({ rawLrc: "[00:00.00]Stale during MV" });
    await settle();
    expect(lyricManager.lyricState.lyrics).toHaveLength(0);
    expect(lyricManager.getLyricDiagnosticSnapshot().nativeOutput.text).toBe("");
    player.videoOwnsPlayback = false; player.audioTimelineAvailable = true;
    fire(TrackPlayerEvents.AudioTimelineChanged);
    await settle();
    expect(getLyric).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).toContain("Restored");
});

it("rejects an old result even if MV has already returned to audio", async () => {
    const late = deferred<any>();
    const fresh = deferred<any>();
    const getLyric = jest.fn().mockImplementationOnce(() => late.promise)
        .mockImplementationOnce(() => fresh.promise);
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("D"); player.audioTimelineAvailable = false;
    fire(TrackPlayerEvents.CurrentMusicChanged);
    player.videoOwnsPlayback = true;
    fire(TrackPlayerEvents.MusicVideoOwnershipChanged);
    player.videoOwnsPlayback = false; player.audioTimelineAvailable = true;
    fire(TrackPlayerEvents.AudioTimelineChanged);
    expect(getLyric).toHaveBeenCalledTimes(2);
    late.resolve({ rawLrc: "[00:00.00]Old before MV" });
    await settle();
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).not.toContain("Old before MV");
    fresh.resolve({ rawLrc: "[00:00.00]After MV" });
    await settle();
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).toContain("After MV");
});

it("keeps a newer explicit lyric request when an older request finishes late", async () => {
    const late = deferred<any>();
    const getLyric = jest.fn().mockImplementationOnce(() => late.promise)
        .mockResolvedValueOnce({ rawLrc: "[00:00.00]Selected" });
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("A");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    lyricManager.associateLyric(player.currentMusic, song("other") as any);
    await settle();
    late.resolve({ rawLrc: "[00:00.00]Old request" });
    await settle();
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).toContain("Selected");
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).not.toContain("Old request");
});

it("does not publish a pending request after the manager is disposed", async () => {
    const late = deferred<any>();
    const getLyric = jest.fn(() => late.promise);
    const { player, fire } = await setup(getLyric);
    player.currentMusic = song("dispose");
    fire(TrackPlayerEvents.CurrentMusicChanged);
    lyricManager.dispose();
    late.resolve({ rawLrc: "[00:00.00]Disposed response" });
    await settle();
    expect(JSON.stringify(lyricManager.lyricState.lyrics)).not.toContain("Disposed response");
});
