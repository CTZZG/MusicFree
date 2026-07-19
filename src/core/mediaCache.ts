import { addFileScheme } from "@/utils/fileUtils";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { exists, unlink } from "react-native-fs";
import {
    buildMediaCacheEntries,
    getUniqueMediaCacheKeys,
    normalizeMediaCacheItem,
} from "./mediaCacheListPolicy";

// Internal Method
const mediaCacheStore = getOrCreateMMKV("cache.MediaCache", true);

// 最多缓存1500条数据
const maxCacheCount = 1500;
const evictionCount = Math.floor(maxCacheCount / 2);
const evictionBatchSize = 25;
let evictionTask: Promise<void> | null = null;

interface IMediaCacheEvictionCandidate {
    key: string;
    raw: string;
}

export async function evictMediaCacheKeys<T>(
    keys: readonly T[],
    removeEntry: (key: T) => Promise<unknown>,
    batchSize = evictionBatchSize,
) {
    for (let index = 0; index < keys.length; index += batchSize) {
        await Promise.all(keys.slice(index, index + batchSize).map(removeEntry));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
}

/** 获取meta信息 */
const getMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const cacheMediaItem = mediaCacheStore.getString(
            getMediaUniqueKey(mediaItem),
        );
        return cacheMediaItem
            ? normalizeMediaCacheItem(safeParse(cacheMediaItem))
            : null;
    }

    return null;
};

/** 设置meta信息 */
const setMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        const cacheKey = getMediaUniqueKey(mediaItem);
        const rawCacheMedia = JSON.stringify(mediaItem);

        // Commit the newest value first and never select that key for the
        // eviction started by this write.
        mediaCacheStore.set(cacheKey, rawCacheMedia);
        const allKeys = mediaCacheStore.getAllKeys();
        if (allKeys.length >= maxCacheCount && !evictionTask) {
            const candidates = allKeys
                .filter(key => key !== cacheKey)
                .slice(0, evictionCount)
                .map(key => ({
                    key,
                    raw: mediaCacheStore.getString(key),
                }))
                .filter(
                    (candidate): candidate is IMediaCacheEvictionCandidate =>
                        typeof candidate.raw === "string",
                );
            evictionTask = evictMediaCacheKeys(
                candidates,
                candidate =>
                    removeMediaCacheEntry(candidate.key, candidate.raw),
            ).finally(() => {
                evictionTask = null;
            });
        }
        return true;
    }

    return false;
};

async function clearLocalCaches(
    cacheData?: IMusic.IMusicItemCache | null,
    canRemove: () => boolean = () => true,
) {
    if (!cacheData) {
        return;
    }
    if (cacheData.$localLyric) {
        await checkPathAndRemove(cacheData.$localLyric.rawLrc, canRemove);
        await checkPathAndRemove(cacheData.$localLyric.translation, canRemove);
    }
}

async function checkPathAndRemove(
    filePath?: string,
    canRemove: () => boolean = () => true,
) {
    if (!filePath || !canRemove()) {
        return;
    }
    filePath = addFileScheme(filePath);
    if ((await exists(filePath)) && canRemove()) {
        await unlink(filePath);
    }
}

/** 移除缓存信息 */
const removeMediaCache = (mediaItem: ICommon.IMediaBase) => {
    if (mediaItem.platform && mediaItem.id) {
        mediaCacheStore.delete(getMediaUniqueKey(mediaItem));
        return true;
    }

    return false;
};

const removeMediaCacheEntry = async (key: string, expectedRaw?: string) => {
    const rawCacheMedia = mediaCacheStore.getString(key);
    if (expectedRaw !== undefined && rawCacheMedia !== expectedRaw) {
        return false;
    }
    const snapshotRaw = expectedRaw ?? rawCacheMedia;
    const cacheData = rawCacheMedia
        ? safeParse<IMusic.IMusicItemCache>(rawCacheMedia)
        : null;
    const isCurrent = () =>
        mediaCacheStore.getString(key) === snapshotRaw;
    await clearLocalCaches(cacheData, isCurrent);
    if (!isCurrent()) {
        return false;
    }
    mediaCacheStore.delete(key);
    return true;
};

const removeMediaCacheEntries = async (keys: readonly string[]) => {
    const uniqueKeys = getUniqueMediaCacheKeys(keys);
    await Promise.all(uniqueKeys.map(key => removeMediaCacheEntry(key)));
    return uniqueKeys.length;
};

const getMediaCacheEntries = () =>
    buildMediaCacheEntries(
        mediaCacheStore.getAllKeys().map(key => ({
            key,
            raw: mediaCacheStore.getString(key),
        })),
    );

const getMediaCacheStats = () => {
    const keys = mediaCacheStore.getAllKeys();
    let approximateSize = 0;
    keys.forEach(key => {
        approximateSize += mediaCacheStore.getString(key)?.length ?? 0;
    });

    return {
        count: keys.length,
        approximateSize,
    };
};

const clearAllMediaCache = async () => {
    await evictionTask;
    const keys = mediaCacheStore.getAllKeys();
    await Promise.all(
        keys.map(async key => {
            const rawCacheMedia = mediaCacheStore.getString(key);
            const cacheData = rawCacheMedia
                ? safeParse<IMusic.IMusicItemCache>(rawCacheMedia)
                : null;
            await clearLocalCaches(cacheData as IMusic.IMusicItemCache);
        }),
    );
    mediaCacheStore.clearAll();
};

const MediaCache = {
    getMediaCache,
    setMediaCache,
    removeMediaCache,
    removeMediaCacheEntry,
    removeMediaCacheEntries,
    getMediaCacheEntries,
    getMediaCacheStats,
    clearAllMediaCache,
    waitForPendingEviction: async () => evictionTask,
};

export default MediaCache;
