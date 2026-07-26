import PluginManager from "@/core/pluginManager";
import { isUsableArtworkUri } from "@/utils/artworkSourcePolicy";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { validateRemoteNetworkUrl } from "@/utils/remoteNetworkPolicy";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";

const LOOKUP_TIMEOUT_MS = 3_000;
const SUCCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 96;
const MAX_GLOBAL_PLUGIN_LOOKUPS = 4;
const MAX_CONCURRENT_LOOKUPS = 2;
const ITUNES_REQUEST_TIMEOUT_MS = 3_200;
const ITUNES_ARTWORK_SIZE = 1200;
const itunesHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 1024 * 1024,
    maxTimeoutMs: ITUNES_REQUEST_TIMEOUT_MS,
});

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

interface IItunesSearchResult {
    trackId?: number;
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    artworkUrl100?: string;
}

const artworkCache = new Map<string, IArtworkCacheEntry>();
const inFlightLookups = new Map<string, Promise<string | undefined>>();

let activeLookupCount = 0;
interface ILookupWaiter {
    deadline: number;
    timeout: ReturnType<typeof setTimeout>;
    resolve(acquired: boolean): void;
}
const lookupWaiters: ILookupWaiter[] = [];

function acquireLookupSlot(deadline: number): Promise<boolean> {
    if (activeLookupCount < MAX_CONCURRENT_LOOKUPS) {
        activeLookupCount += 1;
        return Promise.resolve(true);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        return Promise.resolve(false);
    }

    return new Promise(resolve => {
        const waiter: ILookupWaiter = {
            deadline,
            resolve,
            timeout: setTimeout(() => {
                const index = lookupWaiters.indexOf(waiter);
                if (index >= 0) {
                    lookupWaiters.splice(index, 1);
                }
                resolve(false);
            }, remaining),
        };
        lookupWaiters.push(waiter);
    });
}

function releaseLookupSlot() {
    activeLookupCount = Math.max(0, activeLookupCount - 1);
    while (lookupWaiters.length > 0) {
        const waiter = lookupWaiters.shift()!;
        clearTimeout(waiter.timeout);
        if (waiter.deadline <= Date.now()) {
            waiter.resolve(false);
            continue;
        }
        activeLookupCount += 1;
        waiter.resolve(true);
        break;
    }
}

export function isUsableMusicDetailArtwork(
    artwork: unknown,
): artwork is string {
    return typeof artwork === "string" && isUsableArtworkUri(artwork);
}

function normalizeMatchText(value?: string) {
    return (value ?? "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function getMusicArtworkLookupKey(musicItem: IMusic.IMusicItem) {
    return [
        getMediaUniqueKey(musicItem),
        normalizeMatchText(musicItem.title),
        normalizeMatchText(musicItem.artist),
        normalizeMatchText(musicItem.album),
    ].join("|");
}

export function getCachedMusicArtwork(musicItem: IMusic.IMusicItem) {
    if (isUsableMusicDetailArtwork(musicItem.artwork)) {
        return musicItem.artwork.trim();
    }

    const key = getMusicArtworkLookupKey(musicItem);
    const now = Date.now();
    const cached = artworkCache.get(key);
    if (cached && cached.expiresAt > now) {
        return cached.artwork;
    }
    return undefined;
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
            const getArtistScore = (candidate: string, expected: string) => {
                if (!expected) {
                    return 1;
                }
                if (!candidate) {
                    return 0;
                }
                if (candidate === expected) {
                    return 2;
                }
                return candidate.includes(expected) ||
                    expected.includes(candidate)
                    ? 1
                    : 0;
            };
            const directArtistScore =
                title === expectedTitle
                    ? getArtistScore(artist, expectedArtist)
                    : 0;
            // 部分本地文件会把 title / artist 标签写反；仅接受两边都能精确对应的互换结果。
            const swappedArtistScore =
                expectedArtist.length > 0 && title === expectedArtist
                    ? getArtistScore(artist, expectedTitle)
                    : 0;
            if (!directArtistScore && !swappedArtistScore) {
                return null;
            }

            return {
                artwork: item.artwork.trim(),
                score: directArtistScore
                    ? 100 + directArtistScore
                    : 10 + swappedArtistScore,
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
    task: () => Promise<T>,
    deadline: number,
): Promise<T | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        return Promise.resolve(undefined);
    }

    return new Promise(resolve => {
        acquireLookupSlot(deadline).then(acquired => {
            if (!acquired) {
                resolve(undefined);
                return;
            }

            let settled = false;
            const finish = (value: T | undefined) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                releaseLookupSlot();
                resolve(value);
            };
            const timeout = setTimeout(
                () => finish(undefined),
                Math.max(0, deadline - Date.now()),
            );
            Promise.resolve()
                .then(task)
                .then(
                    value => finish(value),
                    () => finish(undefined),
                );
        });
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

function createGlobalPluginLookups(musicItem: IMusic.IMusicItem) {
    const manager = PluginManager as typeof PluginManager & {
        getSearchablePlugins?: (type: "music") => Array<{
            name?: string;
            methods: {
                search: (
                    query: string,
                    page: number,
                    type: "music",
                ) => Promise<{data?: IMusic.IMusicItem[]}>;
            };
        }>;
    };
    const plugins = manager.getSearchablePlugins?.("music") ?? [];

    return plugins
        .filter(plugin => plugin.name !== musicItem.platform)
        .slice(0, MAX_GLOBAL_PLUGIN_LOOKUPS)
        .map<IMusicDetailArtworkLookup>(plugin => ({
            search: async query => {
                const result = await plugin.methods.search(query, 1, "music");
                return result?.data ?? [];
            },
        }));
}

function upscaleItunesArtwork(artwork?: string) {
    if (!isUsableMusicDetailArtwork(artwork)) {
        return undefined;
    }
    const candidate = artwork
        .trim()
        .replace(
            /\/\d+x\d+bb\.(jpg|jpeg|png)$/iu,
            `/${ITUNES_ARTWORK_SIZE}x${ITUNES_ARTWORK_SIZE}bb.$1`,
        );
    return validateRemoteNetworkUrl(candidate, {
        subject: "iTunes 封面链接",
    }).ok
        ? candidate
        : undefined;
}

function createItunesArtworkLookup(): IMusicDetailArtworkLookup {
    return {
        search: async query => {
            const params = [
                `term=${encodeURIComponent(query)}`,
                "media=music",
                "entity=song",
                "limit=12",
            ].join("&");
            const response = await itunesHttpClient.get(
                `https://itunes.apple.com/search?${params}`,
                {
                    headers: { accept: "application/json" },
                    timeout: ITUNES_REQUEST_TIMEOUT_MS,
                },
            );
            const payload = response.data as {
                results?: IItunesSearchResult[];
            };
            return (payload.results ?? [])
                .map((item, index) => {
                    const artwork = upscaleItunesArtwork(
                        item.artworkUrl100,
                    );
                    if (!artwork) {
                        return null;
                    }
                    return {
                        id: String(item.trackId ?? `result-${index}`),
                        platform: "itunes-cover",
                        title: item.trackName ?? "",
                        artist: item.artistName ?? "",
                        album: item.collectionName ?? "",
                        artwork,
                    } as IMusic.IMusicItem;
                })
                .filter((item): item is IMusic.IMusicItem => item !== null);
        },
    };
}

function trimCache(
    cache: Map<string, IArtworkCacheEntry>,
    maxEntries: number,
    now = Date.now(),
) {
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) {
            cache.delete(key);
        }
    }

    if (cache.size <= maxEntries) {
        return;
    }

    const overflow = [...cache.entries()]
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
        .slice(0, cache.size - maxEntries);
    overflow.forEach(([key]) => cache.delete(key));
}

async function resolveWithLookup(
    musicItem: IMusic.IMusicItem,
    lookup: IMusicDetailArtworkLookup | undefined,
    query: string,
    deadline: number,
) {
    if (!lookup) {
        return undefined;
    }

    if (lookup.getMusicInfo) {
        const details = await withDeadline(
            () => Promise.resolve().then(() => lookup.getMusicInfo!(musicItem)),
            deadline,
        );
        if (isUsableMusicDetailArtwork(details?.artwork)) {
            return details.artwork.trim();
        }
    }

    if (!lookup.search || !query || Date.now() >= deadline) {
        return undefined;
    }

    const results = await withDeadline(
        () => Promise.resolve().then(() => lookup.search!(query)),
        deadline,
    );
    return selectArtworkFromSearchResults(musicItem, results ?? []);
}

async function resolveUncachedArtwork(
    musicItem: IMusic.IMusicItem,
    lookup: IMusicDetailArtworkLookup | undefined,
    includeGlobalPlugins: boolean,
) {
    const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
    const query = [musicItem.title, musicItem.artist]
        .filter(Boolean)
        .join(" ")
        .trim();
    const itunesArtworkPromise = includeGlobalPlugins
        ? resolveWithLookup(
            musicItem,
            createItunesArtworkLookup(),
            query,
            Date.now() + ITUNES_REQUEST_TIMEOUT_MS,
        )
        : undefined;
    const primaryArtwork = await resolveWithLookup(
        musicItem,
        lookup,
        query,
        deadline,
    );
    if (primaryArtwork || !includeGlobalPlugins) {
        return primaryArtwork;
    }

    for (const globalLookup of createGlobalPluginLookups(musicItem)) {
        if (Date.now() >= deadline) {
            break;
        }
        const artwork = await resolveWithLookup(
            musicItem,
            globalLookup,
            query,
            deadline,
        );
        if (artwork) {
            return artwork;
        }
    }
    return itunesArtworkPromise;
}

/**
 * 供需要展示歌曲封面的界面共享。查询结果仅保存在内存中，不修改播放队列、
 * 历史记录或本地音频文件。
 */
export function resolveMusicDetailArtwork(
    musicItem: IMusic.IMusicItem,
    lookup?: IMusicDetailArtworkLookup,
) {
    if (isUsableMusicDetailArtwork(musicItem.artwork)) {
        return Promise.resolve(musicItem.artwork.trim());
    }

    const key = getMusicArtworkLookupKey(musicItem);
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

    const includeGlobalPlugins = lookup === undefined;
    const resolvedLookup = lookup ?? createPluginLookup(musicItem);
    const task = resolveUncachedArtwork(
        musicItem,
        resolvedLookup,
        includeGlobalPlugins,
    )
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
            trimCache(artworkCache, MAX_CACHE_ENTRIES, resolvedAt);
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
    activeLookupCount = 0;
    lookupWaiters.splice(0, lookupWaiters.length).forEach(waiter => {
        clearTimeout(waiter.timeout);
        waiter.resolve(false);
    });
}
