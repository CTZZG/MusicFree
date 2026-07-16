import PluginManager from "@/core/pluginManager";
import { getMediaUniqueKey } from "@/utils/mediaUtils";

const LOOKUP_TIMEOUT_MS = 4_500;
const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 96;

interface IArtworkCacheEntry {
    artwork?: string;
    expiresAt: number;
    lastAccessedAt: number;
}

export interface IMusicDetailArtworkLookup {
    getMusicInfo?: (
        musicItem: IMusic.IMusicItem,
    ) => Promise<Partial<IMusic.IMusicItem> | null>;
    search?: (query: string) => Promise<IMusic.IMusicItem[]>;
}

const artworkCache = new Map<string, IArtworkCacheEntry>();
const inFlightLookups = new Map<string, Promise<string | undefined>>();

export function isUsableMusicDetailArtwork(
    artwork: unknown,
): artwork is string {
    return typeof artwork === "string" && artwork.trim().length > 0;
}

function normalizeMatchText(value?: string) {
    return (value ?? "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function selectArtworkFromSearchResults(
    musicItem: IMusic.IMusicItem,
    results: IMusic.IMusicItem[],
) {
    const expectedTitle = normalizeMatchText(musicItem.title);
    const expectedArtist = normalizeMatchText(musicItem.artist);

    if (!expectedTitle) {
        return undefined;
    }

    const candidates = results
        .filter(item => isUsableMusicDetailArtwork(item?.artwork))
        .map(item => {
            const title = normalizeMatchText(item.title);
            const artist = normalizeMatchText(item.artist);
            if (title !== expectedTitle) {
                return null;
            }

            const artistMatches =
                !expectedArtist ||
                (artist &&
                    (artist === expectedArtist ||
                        artist.includes(expectedArtist) ||
                        expectedArtist.includes(artist)));
            if (!artistMatches) {
                return null;
            }

            return {
                artwork: item.artwork,
                score: artist === expectedArtist ? 2 : 1,
            };
        })
        .filter(
            (
                item,
            ): item is {
                artwork: string;
                score: number;
            } => !!item,
        )
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.artwork;
}

function withDeadline<T>(
    promise: Promise<T>,
    deadline: number,
): Promise<T | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        return Promise.resolve(undefined);
    }

    return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(undefined), remaining);
        promise.then(
            value => {
                clearTimeout(timeout);
                resolve(value);
            },
            () => {
                clearTimeout(timeout);
                resolve(undefined);
            },
        );
    });
}

function createPluginLookup(
    musicItem: IMusic.IMusicItem,
): IMusicDetailArtworkLookup | undefined {
    const plugin = PluginManager.getByMedia(musicItem);
    if (!plugin) {
        return undefined;
    }

    const supports = (method: string) =>
        !plugin.supportedMethods || plugin.supportedMethods.has(method as any);

    return {
        getMusicInfo: supports("getMusicInfo")
            ? item => plugin.methods.getMusicInfo(item)
            : undefined,
        search: supports("search")
            ? async query => {
                const result = await plugin.methods.search(query, 1, "music");
                return result.data as IMusic.IMusicItem[];
            }
            : undefined,
    };
}

function trimCache(now = Date.now()) {
    for (const [key, entry] of artworkCache) {
        if (entry.expiresAt <= now) {
            artworkCache.delete(key);
        }
    }

    if (artworkCache.size <= MAX_CACHE_ENTRIES) {
        return;
    }

    const overflow = [...artworkCache.entries()]
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
        .slice(0, artworkCache.size - MAX_CACHE_ENTRIES);
    overflow.forEach(([key]) => artworkCache.delete(key));
}

async function resolveUncachedArtwork(
    musicItem: IMusic.IMusicItem,
    lookup: IMusicDetailArtworkLookup | undefined,
) {
    if (!lookup) {
        return undefined;
    }

    const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
    if (lookup.getMusicInfo) {
        const details = await withDeadline(
            Promise.resolve().then(() => lookup.getMusicInfo!(musicItem)),
            deadline,
        );
        if (isUsableMusicDetailArtwork(details?.artwork)) {
            return details.artwork.trim();
        }
    }

    if (!lookup.search || Date.now() >= deadline) {
        return undefined;
    }

    const query = [musicItem.title, musicItem.artist]
        .filter(Boolean)
        .join(" ")
        .trim();
    if (!query) {
        return undefined;
    }

    const results = await withDeadline(
        Promise.resolve().then(() => lookup.search!(query)),
        deadline,
    );
    return selectArtworkFromSearchResults(musicItem, results ?? []);
}

/**
 * 只供播放详情页调用。查询结果仅保存在内存中，不修改播放队列或持久化状态。
 */
export function resolveMusicDetailArtwork(
    musicItem: IMusic.IMusicItem,
    lookup: IMusicDetailArtworkLookup | undefined = createPluginLookup(
        musicItem,
    ),
) {
    if (isUsableMusicDetailArtwork(musicItem.artwork)) {
        return Promise.resolve(musicItem.artwork.trim());
    }

    const key = getMediaUniqueKey(musicItem);
    const now = Date.now();
    const cached = artworkCache.get(key);
    if (cached && cached.expiresAt > now) {
        cached.lastAccessedAt = now;
        return Promise.resolve(cached.artwork);
    }
    if (cached) {
        artworkCache.delete(key);
    }

    const inFlight = inFlightLookups.get(key);
    if (inFlight) {
        return inFlight;
    }

    const task = resolveUncachedArtwork(musicItem, lookup)
        .catch(() => undefined)
        .then(artwork => {
            const resolvedAt = Date.now();
            artworkCache.set(key, {
                artwork,
                expiresAt:
                    resolvedAt +
                    (artwork ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
                lastAccessedAt: resolvedAt,
            });
            trimCache(resolvedAt);
            return artwork;
        })
        .finally(() => {
            if (inFlightLookups.get(key) === task) {
                inFlightLookups.delete(key);
            }
        });

    inFlightLookups.set(key, task);
    return task;
}

export function resetMusicDetailArtworkCacheForTests() {
    artworkCache.clear();
    inFlightLookups.clear();
}
