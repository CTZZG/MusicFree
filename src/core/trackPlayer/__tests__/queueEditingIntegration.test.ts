export {};

function mockAutoStub(): any {
    const cache: Record<string | symbol, unknown> = {};
    return new Proxy(cache, {
        get(target, key) {
            if (key === "__esModule") {
                return true;
            }
            if (key === "then") {
                return undefined;
            }
            if (!(key in target)) {
                target[key] = key === "default" ? mockAutoStub() : jest.fn();
            }
            return target[key];
        },
    });
}

const mockBackend: any = new Proxy(
    {
        active: null as any,
        getActiveTrack: jest.fn(async () => mockBackend.active?.track ?? null),
        getActiveTrackIndex: jest.fn(async () => mockBackend.active?.index ?? null),
        getState: jest.fn(async () => "playing"),
        getProgress: jest.fn(async () => ({ position: 30, duration: 200, buffered: 30 })),
        restoreActiveTrack: jest.fn(async () => true),
    } as Record<string, any>,
    {
        // 其余方法（同步队列、预备下一首……）一律当作成功
        get(target, key) {
            if (!(key in target) && typeof key === "string") {
                target[key] = jest.fn(async () => undefined);
            }
            return target[key as string];
        },
    },
);

jest.mock("@/core/playerAdapter", () => ({
    __esModule: true,
    resolvePlayerAdapter: () => mockBackend,
}));
jest.mock("@/utils/delay", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    Easing: {
        out: () => () => 0,
        inOut: () => () => 0,
        bezier: () => () => 0,
        exp: () => 0,
        linear: () => 0,
        cubic: () => 0,
        quad: () => 0,
    },
    makeMutable: (value: unknown) => ({ value }),
    cancelAnimation: () => {},
    withTiming: (value: unknown) => value,
}));
jest.mock("immer", () => ({
    __esModule: true,
    produce: (base: unknown, recipe: (draft: any) => unknown) => {
        const draft = structuredClone(base);
        const result = recipe(draft);
        return result === undefined ? draft : result;
    },
}));
// 原生模块、持久化和插件相关的依赖与这段时序无关
jest.mock("@/utils/log", () => mockAutoStub());
jest.mock("react-native-fs", () => mockAutoStub());
jest.mock("@/utils/getOrCreateMMKV", () => mockAutoStub());
jest.mock("@/utils/network", () => mockAutoStub());
jest.mock("@/utils/persistStatus", () => mockAutoStub());
jest.mock("@/core/localMusicSheet", () => mockAutoStub());
jest.mock("@/core/dislikeMusic", () => mockAutoStub());
jest.mock("@/core/mediaCache", () => mockAutoStub());
jest.mock("@/core/localMusicArtworkManager", () => mockAutoStub());
jest.mock("@/constants/assetsConst", () => mockAutoStub());
jest.mock("@/native/utils", () => mockAutoStub());
jest.mock("@/service/encryptedMediaProxy", () => mockAutoStub());
jest.mock("@/core/lastfm", () => mockAutoStub());
jest.mock("@/utils/androidMediaPermission", () => mockAutoStub());
jest.mock("@/utils/userAgentHelper", () => mockAutoStub());

const trackPlayerModule = require("@/core/trackPlayer");
const trackPlayer = trackPlayerModule.default;
const getUndo = trackPlayerModule.getQueueUndoNotice;
const player = trackPlayer as any;

const songs = ["A", "B", "C", "D", "E", "F"].map(id => ({
    id,
    platform: "test",
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    artwork: "",
    duration: 200,
}));

const [songA, songB, songC, songD] = songs;

beforeEach(() => {
    jest.clearAllMocks();
    mockBackend.getState.mockImplementation(async () => "playing");
    mockBackend.reset.mockImplementation(async () => undefined);
    player.lockBackend();
    player.configService = { getConfig: jest.fn() };
    player.setPlayList(songs, false);
    player.setPlayLaterQueue([]);
    player.setCurrentMusic(songB);
    mockBackend.active = { track: songB, index: 1 };
    player.beginQueueEdit();
    jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());
const ids = (items: IMusic.IMusicItem[]) => items.map(item => item.id);

it("reorders the queue through MPV without restarting, seeking or changing current song", () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    expect(trackPlayer.moveQueueItem(songD, 0)).toBe(true);
    expect(ids(trackPlayer.playList)).toEqual(["D", "A", "B", "C", "E", "F"]);
    expect(trackPlayer.currentMusic.id).toBe("B");
    expect(mockBackend.syncQueueOrder).toHaveBeenLastCalledWith(trackPlayer.playList, "test@B");
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.reset).not.toHaveBeenCalled();
    expect(mockBackend.seekTo).not.toHaveBeenCalled();
});

it("move-next places an earlier track after current and honors an existing priority queue", () => {
    player.setPlayLaterQueue([songD, songC]);
    expect(trackPlayer.moveQueueItemNext(songA)).toBe(true);
    expect(ids(trackPlayer.playList).slice(0, 3)).toEqual(["B", "A", "C"]);
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["A", "D", "C"]);
    expect(trackPlayer.currentMusic.id).toBe("B");
    expect(mockBackend.reset).not.toHaveBeenCalled();
});

it("reorders priority entries without altering the main queue", () => {
    player.setPlayLaterQueue([songA, songD, songC]);
    expect(trackPlayer.moveQueueItem(songC, 0, "later")).toBe(true);
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["C", "A", "D"]);
    expect(ids(trackPlayer.playList)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(mockBackend.syncQueueOrder).not.toHaveBeenCalled();
});

it("undo of a non-current removal keeps current music and newly hydrated metadata", async () => {
    await trackPlayer.removeQueueItemWithUndo(songA);
    const notice = getUndo();
    expect(notice).toMatchObject({ action: "remove", count: 1 });
    player.setPlayList(trackPlayer.playList.map((item: IMusic.IMusicItem) => item.id === "C" ? { ...item, url: "https://example.test/fresh" } : item));
    expect(getUndo()).toEqual(notice);
    expect(trackPlayer.undoQueueEdit(notice.id)).toBe(true);
    expect(ids(trackPlayer.playList)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(trackPlayer.playList[2].url).toBe("https://example.test/fresh");
    expect(trackPlayer.currentMusic.id).toBe("B");
    expect(trackPlayer.undoQueueEdit(notice.id)).toBe(false);
    expect(mockBackend.reset).not.toHaveBeenCalled();
});

it("undo of a priority removal or clear restores its order", async () => {
    player.setPlayLaterQueue([songA, songD, songC]);
    await trackPlayer.removeQueueItemWithUndo(songD, "later");
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["A", "C"]);
    expect(trackPlayer.undoQueueEdit(getUndo().id)).toBe(true);
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["A", "D", "C"]);
    await trackPlayer.clearQueueWithUndo("later");
    expect(getUndo()).toMatchObject({ action: "clear", count: 3 });
    expect(trackPlayer.undoQueueEdit(getUndo().id)).toBe(true);
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["A", "D", "C"]);
    expect(mockBackend.reset).not.toHaveBeenCalled();
});

it("clear empties both queues and undo restores them with playback stopped", async () => {
    player.setPlayLaterQueue([songD, songA]);
    await trackPlayer.clearQueueWithUndo();
    expect(trackPlayer.playList).toEqual([]);
    expect(trackPlayer.playLaterQueue).toEqual([]);
    expect(trackPlayer.currentMusic).toBeNull();
    expect(getUndo()).toMatchObject({ action: "clear", count: 8 });
    expect(trackPlayer.undoQueueEdit(getUndo().id)).toBe(true);
    expect(ids(trackPlayer.playList)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(ids(trackPlayer.playLaterQueue)).toEqual(["D", "A"]);
    expect(trackPlayer.currentMusic).toBeNull();
    expect(mockBackend.reset).toHaveBeenCalledTimes(1);
    expect(mockBackend.play).not.toHaveBeenCalled();
});

it.each(["reorder", "add", "remove", "play", "current-change"])("invalidates undo after a newer %s", async kind => {
    await trackPlayer.removeQueueItemWithUndo(songA);
    const notice = getUndo();
    if (kind === "reorder") trackPlayer.moveQueueItem(songD, 0);
    if (kind === "add") trackPlayer.add(songA);
    if (kind === "remove") await trackPlayer.remove(songD);
    if (kind === "play") await trackPlayer.play(null);
    if (kind === "current-change") player.setCurrentMusic(songC);
    expect(getUndo()).toBeNull();
    expect(trackPlayer.undoQueueEdit(notice.id)).toBe(false);
});

it("a stale undo identifier cannot consume a newer removal", async () => {
    await trackPlayer.removeQueueItemWithUndo(songA);
    const first = getUndo();
    await trackPlayer.removeQueueItemWithUndo(songD);
    const second = getUndo();
    expect(trackPlayer.undoQueueEdit(first.id)).toBe(false);
    expect(getUndo()).toEqual(second);
    expect(trackPlayer.undoQueueEdit(second.id)).toBe(true);
    expect(ids(trackPlayer.playList)).toEqual(["B", "C", "D", "E", "F"]);
});

it("does not publish an old clear undo after a newer edit arrives while reset is pending", async () => {
    let finish = () => {};
    mockBackend.reset.mockImplementationOnce(() => new Promise<void>(resolve => {
        finish = resolve;
    }));
    const clearing = trackPlayer.clearQueueWithUndo();
    trackPlayer.add(songA);
    finish();
    await clearing;
    expect(getUndo()).toBeNull();
    expect(ids(trackPlayer.playList)).toEqual(["A"]);
});

/** 删除正在放的 B 时，第一次查播放状态先挂住，测试在这期间插入别的操作 */
function holdFirstStateQuery() {
    let finish: (state: string) => void = () => {};
    mockBackend.getState.mockImplementationOnce(() => new Promise<string>(resolve => {
        finish = resolve;
    }));
    return (state: string) => finish(state);
}

it("redoes a current-song removal on the latest queue when a reorder lands during the native state query", async () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    const finish = holdFirstStateQuery();
    const removing = trackPlayer.removeQueueItemWithUndo(songB);
    trackPlayer.moveQueueItem(songD, 0);
    finish("playing");
    await removing;
    // 重排保留，B 照样删掉；接着放的是新顺序里 B 后面那首
    expect(ids(trackPlayer.playList)).toEqual(["D", "A", "C", "E", "F"]);
    expect(trackPlayer.currentMusic.id).toBe("C");
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toMatchObject({ id: "C" });
    // 撤销回到重排之后、删除之前
    expect(trackPlayer.undoQueueEdit(getUndo().id)).toBe(true);
    expect(ids(trackPlayer.playList)).toEqual(["D", "A", "B", "C", "E", "F"]);
    expect(trackPlayer.currentMusic.id).toBe("C");
});

it("only takes the song out of the queue when playback moved on during the native state query", async () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    const finish = holdFirstStateQuery();
    const removing = trackPlayer.removeQueueItemWithUndo(songB);
    // 原生这时放完 B，自动接着放 C
    player.setCurrentMusic(songC);
    finish("playing");
    await removing;
    expect(ids(trackPlayer.playList)).toEqual(["A", "C", "D", "E", "F"]);
    expect(trackPlayer.currentMusic.id).toBe("C");
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.reset).not.toHaveBeenCalled();
    expect(getUndo()).toMatchObject({ action: "remove", count: 1 });
});

it("uses the newer playback state when a pause lands during the native state query", async () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    const finish = holdFirstStateQuery();
    const removing = trackPlayer.removeQueueItemWithUndo(songB);
    await trackPlayer.pause();
    mockBackend.getState.mockImplementation(async () => "paused");
    finish("playing");
    await removing;
    // 暂停之后删掉正在放的歌：换到下一首但不播放
    expect(ids(trackPlayer.playList)).toEqual(["A", "C", "D", "E", "F"]);
    expect(trackPlayer.currentMusic.id).toBe("C");
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.reset).toHaveBeenCalledTimes(1);
});

it("waits for a skip that is still in flight instead of starting another song over it", async () => {
    const delay = require("@/utils/delay").default as jest.Mock;
    delay.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 0)));
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    let finishSkip = () => {};
    // 一次手动切歌还没完成（例如耳机上按了下一首）
    const skip = player.manualSkipGate.run(() => new Promise<void>(resolve => {
        finishSkip = () => {
            player.setCurrentMusic(songD);
            resolve();
        };
    }));
    const removing = trackPlayer.removeQueueItemWithUndo(songB);
    await new Promise(resolve => setTimeout(resolve, 5));
    // 删除在等切歌，还没动队列
    expect(ids(trackPlayer.playList)).toEqual(["A", "B", "C", "D", "E", "F"]);
    finishSkip();
    await skip;
    await removing;
    // 切歌赢了：放的是 D，B 只是从队列里拿掉，没有再去放 B 后面那首
    expect(trackPlayer.currentMusic.id).toBe("D");
    expect(ids(trackPlayer.playList)).toEqual(["A", "C", "D", "E", "F"]);
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.reset).not.toHaveBeenCalled();
    delay.mockReset();
});

it("does nothing more when the other edit already removed the song", async () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    const finish = holdFirstStateQuery();
    const removing = trackPlayer.removeQueueItemWithUndo(songB);
    player.setPlayList(songs.filter(song => song.id !== "B"));
    finish("playing");
    await removing;
    expect(ids(trackPlayer.playList)).toEqual(["A", "C", "D", "E", "F"]);
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.reset).not.toHaveBeenCalled();
});
