jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: jest.fn((namespace: string) => {
        const storesKey = "__mediaCacheTestStores";
        const globalStore = globalThis as typeof globalThis & {
            [storesKey]?: Map<string, Map<string, string>>;
        };
        if (!globalStore[storesKey]) {
            globalStore[storesKey] = new Map<string, Map<string, string>>();
        }
        const stores = globalStore[storesKey]!;
        if (!stores.has(namespace)) {
            stores.set(namespace, new Map());
        }
        const store = stores.get(namespace)!;
        return {
            getString: jest.fn((key: string) => store.get(key)),
            getAllKeys: jest.fn(() => Array.from(store.keys())),
            set: jest.fn((key: string, value: string) => {
                store.set(key, value);
            }),
            delete: jest.fn((key: string) => {
                store.delete(key);
            }),
            clearAll: jest.fn(() => {
                store.clear();
            }),
        };
    }),
}));

jest.mock("@/utils/fileUtils", () => ({
    addFileScheme: jest.fn((filePath: string) =>
        filePath?.startsWith("file://") ? filePath : `file://${filePath}`,
    ),
}));

jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: jest.fn(
        (mediaItem: {platform?: string; id?: string}) =>
            `${mediaItem.platform}@${mediaItem.id}`,
    ),
}));

jest.mock("react-native-fs", () => ({
    exists: jest.fn(() => Promise.resolve(false)),
    unlink: jest.fn(() => Promise.resolve()),
}));

import MediaCache, { evictMediaCacheKeys } from "../mediaCache";
import { exists, unlink } from "react-native-fs";

const mockExists = exists as jest.Mock;
const mockUnlink = unlink as jest.Mock;

function getMockStores() {
    return (
        globalThis as typeof globalThis & {
            __mediaCacheTestStores?: Map<string, Map<string, string>>;
        }
    ).__mediaCacheTestStores!;
}

describe("MediaCache", () => {
    const mediaItem = {
        id: "track-1",
        platform: "test",
        title: "Track",
    } as IMusic.IMusicItem;

    beforeEach(() => {
        for (const store of getMockStores().values()) {
            store.clear();
        }
        mockExists.mockReset();
        mockExists.mockResolvedValue(false);
        mockUnlink.mockReset();
        mockUnlink.mockResolvedValue(undefined);
    });

    function setRawCache(raw: string) {
        const stores = getMockStores();
        if (!stores.has("cache.MediaCache")) {
            stores.set("cache.MediaCache", new Map());
        }
        stores.get("cache.MediaCache")!.set("test@track-1", raw);
    }

    it("returns normalized cached media items only", () => {
        setRawCache("\"bad\"");
        expect(MediaCache.getMediaCache(mediaItem)).toBeNull();

        setRawCache(JSON.stringify(mediaItem));
        expect(MediaCache.getMediaCache(mediaItem)).toMatchObject({
            id: "track-1",
            platform: "test",
        });
    });

    it("reports whether a media cache entry was removed", () => {
        setRawCache(JSON.stringify(mediaItem));

        expect(MediaCache.removeMediaCache(mediaItem)).toBe(true);
        expect(getMockStores().get("cache.MediaCache")!.has("test@track-1")).toBe(
            false,
        );
        expect(
            MediaCache.removeMediaCache({ id: "track-2" } as IMusic.IMusicItem),
        ).toBe(false);
    });

    it("removes local lyric files when deleting cache entries", async () => {
        mockExists.mockResolvedValue(true);
        setRawCache(
            JSON.stringify({
                ...mediaItem,
                $localLyric: {
                    rawLrc: "/cache/raw.lrc",
                    translation: "file:///cache/translation.lrc",
                    romanization: "/cache/romanization.lrc",
                },
            }),
        );

        await MediaCache.removeMediaCacheEntry("test@track-1");

        expect(mockUnlink).toHaveBeenCalledWith("file:///cache/raw.lrc");
        expect(mockUnlink).toHaveBeenCalledWith(
            "file:///cache/translation.lrc",
        );
        expect(mockUnlink).toHaveBeenCalledWith("file:///cache/romanization.lrc");
        expect(getMockStores().get("cache.MediaCache")!.has("test@track-1")).toBe(
            false,
        );
    });

    it("clears files from entries that only cache romanization", async () => {
        mockExists.mockResolvedValue(true);
        setRawCache(JSON.stringify({
            ...mediaItem,
            $localLyric: { romanization: "/cache/romanization-only.lrc" },
        }));

        await MediaCache.clearAllMediaCache();

        expect(mockUnlink).toHaveBeenCalledWith("file:///cache/romanization-only.lrc");
        expect(MediaCache.getMediaCache(mediaItem)).toBeNull();
    });

    it("cleans romanization during automatic eviction", async () => {
        mockExists.mockResolvedValue(true);
        setRawCache(JSON.stringify({
            ...mediaItem,
            $localLyric: { romanization: "/cache/evicted-romanization.lrc" },
        }));
        const store = getMockStores().get("cache.MediaCache")!;
        for (let index = 0; index < 1498; index++) {
            store.set(`test@old-${index}`, JSON.stringify({
                ...mediaItem,
                id: `old-${index}`,
            }));
        }

        MediaCache.setMediaCache({ ...mediaItem, id: "newest" });
        await MediaCache.waitForPendingEviction();

        expect(mockUnlink).toHaveBeenCalledWith("file:///cache/evicted-romanization.lrc");
        expect(MediaCache.getMediaCache({ ...mediaItem, id: "newest" })).not.toBeNull();
    });

    it("keeps romanization when the entry changes during its file check", async () => {
        let resolveExists!: (value: boolean) => void;
        let markChecking!: () => void;
        const checking = new Promise<void>(resolve => {
            markChecking = resolve;
        });
        mockExists.mockImplementationOnce(() => {
            markChecking();
            return new Promise<boolean>(resolve => {
                resolveExists = resolve;
            });
        });
        setRawCache(JSON.stringify({
            ...mediaItem,
            $localLyric: { romanization: "/cache/old-romanization.lrc" },
        }));
        const removal = MediaCache.removeMediaCacheEntry("test@track-1");
        await Promise.race([checking, removal.then(() => {
            throw new Error("Entry removed without checking its romanization file");
        })]);
        expect(mockExists).toHaveBeenCalledWith("file:///cache/old-romanization.lrc");
        MediaCache.setMediaCache({
            ...mediaItem,
            title: "Updated",
            $localLyric: { romanization: "/cache/new-romanization.lrc" },
        } as IMusic.IMusicItemCache);
        resolveExists(true);
        await removal;

        expect(mockUnlink).not.toHaveBeenCalled();
        expect(MediaCache.getMediaCache(mediaItem)).toMatchObject({ title: "Updated" });
    });

    it("does not evict a cache entry that changed while cleanup was pending", async () => {
        let resolveExists!: (value: boolean) => void;
        mockExists.mockImplementationOnce(
            () =>
                new Promise<boolean>(resolve => {
                    resolveExists = resolve;
                }),
        );
        const oldValue = JSON.stringify({
            ...mediaItem,
            title: "Old Track",
            $localLyric: {
                rawLrc: "/cache/old.lrc",
            },
        });
        setRawCache(oldValue);

        const eviction = MediaCache.removeMediaCacheEntry(
            "test@track-1",
            oldValue,
        );
        await Promise.resolve();

        MediaCache.setMediaCache({
            ...mediaItem,
            title: "New Track",
            $localLyric: {
                rawLrc: "/cache/new.lrc",
            },
        } as IMusic.IMusicItemCache);
        resolveExists(true);
        await eviction;

        expect(MediaCache.getMediaCache(mediaItem)).toMatchObject({
            title: "New Track",
        });
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it("evicts entries in bounded batches", async () => {
        jest.useFakeTimers();
        const active: number[] = [];
        let running = 0;
        let maxRunning = 0;
        const removeEntry = jest.fn(async (key: string) => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            active.push(Number(key));
            await Promise.resolve();
            running--;
        });

        const task = evictMediaCacheKeys(["1", "2", "3", "4", "5"], removeEntry, 2);
        await jest.runAllTimersAsync();
        await task;

        expect(active).toEqual([1, 2, 3, 4, 5]);
        expect(maxRunning).toBeLessThanOrEqual(2);
        jest.useRealTimers();
    });
});
