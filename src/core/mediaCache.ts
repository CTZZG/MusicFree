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
        const allKeys = mediaCacheStore.getAllKeys();
        if (allKeys.length >= maxCacheCount) {
            // TODO: 随机删一半
            for (let i = 0; i < maxCacheCount / 2; ++i) {
                const rawCacheMedia = mediaCacheStore.getString(allKeys[i]);
                const cacheData = rawCacheMedia
                    ? safeParse(rawCacheMedia)
                    : null;
                clearLocalCaches(cacheData);

                mediaCacheStore.delete(allKeys[i]);
            }
        }

        mediaCacheStore.set(getMediaUniqueKey(mediaItem), JSON.stringify(mediaItem));
        return true;
    }

    return false;
};

async function clearLocalCaches(cacheData?: IMusic.IMusicItemCache | null) {
    if (!cacheData) {
        return;
    }
    if (cacheData.$localLyric) {
        await checkPathAndRemove(cacheData.$localLyric.rawLrc);
        await checkPathAndRemove(cacheData.$localLyric.translation);
    }
}

async function checkPathAndRemove(filePath?: string) {
    if (!filePath) {
        return;
    }
    filePath = addFileScheme(filePath);
    if (await exists(filePath)) {
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

const removeMediaCacheEntry = async (key: string) => {
    const rawCacheMedia = mediaCacheStore.getString(key);
    const cacheData = rawCacheMedia
        ? safeParse<IMusic.IMusicItemCache>(rawCacheMedia)
        : null;
    await clearLocalCaches(cacheData);
    mediaCacheStore.delete(key);
};

const removeMediaCacheEntries = async (keys: readonly string[]) => {
    const uniqueKeys = getUniqueMediaCacheKeys(keys);
    await Promise.all(uniqueKeys.map(removeMediaCacheEntry));
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
};

export default MediaCache;
