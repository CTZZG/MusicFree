// 复核 4b4b833b（P1）：0.8.0 起键值存储换成了文件，但按需创建的 store（歌单、
// 各插件的附加信息）只读新文件、从不迁移旧 MMKV。从 MMKV 时代升级上来的用户
// 歌单不见了，下载标记、本地路径、歌词偏移也读不到。
//
// 这里用真实的键值存储、真实的歌单 storage 和 mediaExtra，只把落盘后端换成
// 内存、把 react-native-mmkv 换成装着旧数据的假实例。

const mockLegacy = new Map<string, Record<string, string>>();

jest.mock("react-native-mmkv", () => ({
    createMMKV: ({ id }: { id: string }) => {
        const data = mockLegacy.get(id) ?? {};
        return {
            getAllKeys: () => Object.keys(data),
            getString: (key: string) => data[key],
            getNumber: () => undefined,
            getBoolean: () => undefined,
        };
    },
}));

jest.mock("@/utils/keyValueStore/filePersistence", () => ({
    KV_STORE_DIR: "/kv",
    createFilePersistence: () => ({
        read: async () => null,
        write: async () => undefined,
        remove: async () => undefined,
    }),
}));

jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: { mmkvPath: "/mmkv", mmkvCachePath: "/mmkv-cache" },
}));

jest.mock("@/utils/mediaIdentity", () => ({
    getMediaUniqueKey: (item: { platform: string; id: string }) =>
        `${item.platform}@${item.id}`,
}));

import { encodeSnapshot } from "../snapshotCodec";
import type { IStorePersistence } from "../types";

const song = (id: string, title = id) =>
    ({
        id,
        platform: "kuwo",
        title,
        artist: "歌手",
    }) as IMusic.IMusicItem;

/** 一次“启动”：新的模块实例（单例都重新建）、同一份磁盘 */
function boot(disk: Map<string, string>) {
    let modules!: {
        storage: typeof import("@/core/musicSheet/storage").default;
        mediaExtra: typeof import("@/utils/mediaExtra");
        getKeyValueStore: typeof import("../index").getKeyValueStore;
    };
    jest.isolateModules(() => {
        const registry = require("../index");
        const persistence: IStorePersistence = {
            read: async id => disk.get(id) ?? null,
            write: async (id, contents) => {
                disk.set(id, contents);
            },
            remove: async id => {
                disk.delete(id);
            },
        };
        registry.setKeyValueStorePersistenceForTests(persistence);
        modules = {
            storage: require("@/core/musicSheet/storage").default,
            mediaExtra: require("@/utils/mediaExtra"),
            getKeyValueStore: registry.getKeyValueStore,
        };
    });
    return modules;
}

function legacyMMKV() {
    mockLegacy.clear();
    mockLegacy.set("LocalSheet.music-sheets", {
        data: JSON.stringify([
            { id: "favorite", platform: "本地", title: "我喜欢" },
            { id: "road-trip", platform: "本地", title: "自驾" },
        ]),
    });
    mockLegacy.set("LocalSheet.starred-sheets", {
        data: JSON.stringify([{ id: "top-100", platform: "kuwo", title: "热歌榜" }]),
    });
    mockLegacy.set("LocalSheet.favorite", {
        data: JSON.stringify([song("old-1", "老歌一")]),
        "meta.sort": "title",
    });
    mockLegacy.set("LocalSheet.road-trip", {
        data: JSON.stringify([song("trip-1"), song("trip-2")]),
    });
    mockLegacy.set("MediaExtra.kuwo", {
        "old-1": JSON.stringify({
            downloaded: true,
            localPath: "file:///music/old-1.mp3",
            lyricOffset: 200,
        }),
    });
}

async function openSheets(storage: ReturnType<typeof boot>["storage"]) {
    await storage.hydrateSheetIndex();
    const sheets = storage.getSheets();
    await Promise.all(sheets.map(sheet => storage.hydrateSheet(sheet.id)));
    return sheets;
}

describe("upgrading from the MMKV storage", () => {
    beforeEach(() => {
        legacyMMKV();
    });

    it("brings back sheets, starred sheets, songs and media extras", async () => {
        const disk = new Map<string, string>();
        const { storage, mediaExtra } = boot(disk);

        const sheets = await openSheets(storage);

        expect(sheets.map(sheet => sheet.id)).toEqual(["favorite", "road-trip"]);
        expect(storage.getStarredSheets().map(sheet => sheet.id)).toEqual(["top-100"]);
        expect(storage.getMusicList("favorite").map(item => item.id)).toEqual(["old-1"]);
        expect(storage.getMusicList("road-trip").map(item => item.id)).toEqual(["trip-1", "trip-2"]);
        expect(storage.getSheetMeta("favorite", "sort")).toBe("title");

        mediaExtra.getMediaExtra(song("old-1")); // 第一次访问触发载入
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mediaExtra.getMediaExtra(song("old-1"))).toEqual({
            downloaded: true,
            localPath: "file:///music/old-1.mp3",
            lyricOffset: 200,
        });
    });

    // 已经升级过的用户：新存储里有应用自己建的默认歌单，升级后加的歌、改的
    // 歌词偏移都在新存储里。旧数据要合并进来，不能盖掉这些。
    it("merges with what was written after the upgrade instead of overwriting it", async () => {
        const disk = new Map<string, string>([
            [
                "LocalSheet.music-sheets",
                encodeSnapshot({
                    data: {
                        t: "s",
                        v: JSON.stringify([
                            { id: "favorite", platform: "本地", title: "我喜欢", coverImg: "new.jpg" },
                            { id: "after-upgrade", platform: "本地", title: "升级后新建" },
                        ]),
                    },
                }),
            ],
            [
                "LocalSheet.favorite",
                encodeSnapshot({
                    data: { t: "s", v: JSON.stringify([song("new-1", "新歌")]) },
                    "meta.sort": { t: "s", v: "time" },
                }),
            ],
            [
                "MediaExtra.kuwo",
                encodeSnapshot({
                    "old-1": { t: "s", v: JSON.stringify({ lyricOffset: 500 }) },
                }),
            ],
        ]);
        const { storage, mediaExtra } = boot(disk);

        const sheets = await openSheets(storage);

        expect(sheets.map(sheet => sheet.id)).toEqual(["favorite", "road-trip", "after-upgrade"]);
        expect(sheets[0].coverImg).toBe("new.jpg");
        expect(storage.getMusicList("favorite").map(item => item.id)).toEqual(["new-1", "old-1"]);
        expect(storage.getSheetMeta("favorite", "sort")).toBe("time");
        expect(storage.getMusicList("road-trip").map(item => item.id)).toEqual(["trip-1", "trip-2"]);

        mediaExtra.getMediaExtra(song("old-1"));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mediaExtra.getMediaExtra(song("old-1"))).toEqual({
            downloaded: true,
            localPath: "file:///music/old-1.mp3",
            lyricOffset: 500,
        });
    });

    it("migrates only once, so later changes are not overwritten on the next launch", async () => {
        const disk = new Map<string, string>();
        const first = boot(disk);
        await openSheets(first.storage);
        // 用户删掉了旧歌单里的一首歌，退出
        first.storage.setMusicList("road-trip", [song("trip-2")]);
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.all(
            ["LocalSheet.music-sheets", "LocalSheet.road-trip"].map(id =>
                first.getKeyValueStore(id).flush(),
            ),
        );

        const second = boot(disk);
        await openSheets(second.storage);

        expect(second.storage.getMusicList("road-trip").map(item => item.id)).toEqual(["trip-2"]);
    });

    // 复核 1ec0114c（P2）：读盘、迁移是异步的。第一次访问就删掉附加信息（或卸载
    // 插件清空整个平台），删除先生效，迁移随后又把旧数据搬了回来。
    describe("removing media extras while the migration is still running", () => {
        async function settle(
            modules: ReturnType<typeof boot>,
        ) {
            await new Promise(resolve => setTimeout(resolve, 0));
            await modules.getKeyValueStore("MediaExtra.kuwo").flush();
        }

        async function afterRestart(disk: Map<string, string>) {
            const reloaded = boot(disk);
            reloaded.mediaExtra.getMediaExtra(song("old-1"));
            await new Promise(resolve => setTimeout(resolve, 0));
            return reloaded.mediaExtra.getMediaExtra(song("old-1"));
        }

        it("keeps a removed song's extras removed", async () => {
            const disk = new Map<string, string>();
            const modules = boot(disk);

            modules.mediaExtra.removeMediaExtra(song("old-1"));
            await settle(modules);

            expect(modules.mediaExtra.getMediaExtra(song("old-1"))).toBeNull();
            expect(await afterRestart(disk)).toBeNull();
        });

        it("keeps a cleared platform cleared", async () => {
            const disk = new Map<string, string>();
            const modules = boot(disk);

            modules.mediaExtra.removeAllMediaExtra("kuwo");
            await settle(modules);

            expect(modules.mediaExtra.getMediaExtra(song("old-1"))).toBeNull();
            expect(await afterRestart(disk)).toBeNull();
        });

        it("does not merge the old extras into what was written after the removal", async () => {
            const disk = new Map<string, string>();
            const modules = boot(disk);

            modules.mediaExtra.removeMediaExtra(song("old-1"));
            modules.mediaExtra.patchMediaExtra(song("old-1"), { lyricOffset: 5 });
            await settle(modules);

            expect(modules.mediaExtra.getMediaExtra(song("old-1"))).toEqual({
                lyricOffset: 5,
            });
            expect(await afterRestart(disk)).toEqual({ lyricOffset: 5 });
        });
    });

    // 复核 4b4b833b（P2）：读盘完成前改歌词偏移，同一首歌的下载标记和本地路径丢了
    it("keeps the other fields when a media extra is patched before its store has loaded", async () => {
        mockLegacy.clear();
        const disk = new Map<string, string>([
            [
                "MediaExtra.kuwo",
                encodeSnapshot({
                    "old-1": {
                        t: "s",
                        v: JSON.stringify({
                            downloaded: true,
                            localPath: "file:///music/saved.mp3",
                            lyricOffset: 200,
                        }),
                    },
                }),
            ],
        ]);
        const { mediaExtra, getKeyValueStore } = boot(disk);

        mediaExtra.patchMediaExtra(song("old-1"), { lyricOffset: 500 });
        await new Promise(resolve => setTimeout(resolve, 0));
        await getKeyValueStore("MediaExtra.kuwo").flush();

        const expected = {
            downloaded: true,
            localPath: "file:///music/saved.mp3",
            lyricOffset: 500,
        };
        expect(mediaExtra.getMediaExtra(song("old-1"))).toEqual(expected);
        const reloaded = boot(disk);
        reloaded.mediaExtra.getMediaExtra(song("old-1"));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(reloaded.mediaExtra.getMediaExtra(song("old-1"))).toEqual(expected);
    });
});
