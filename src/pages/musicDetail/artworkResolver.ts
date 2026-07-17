import PluginManager from "@/core/pluginManager";
import { getMediaUniqueKey } from "@/utils/mediaUtils";

const LOOKUP_TIMEOUT_MS = 3_000;
const SUCCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const BACKDROP_SUCCESS_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const BACKDROP_FAILURE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 96;
const MAX_BACKDROP_CACHE_ENTRIES = 64;
const MAX_GLOBAL_PLUGIN_LOOKUPS = 4;
const MAX_CONCURRENT_LOOKUPS = 2;
const TMDB_REQUEST_TIMEOUT_MS = 2_600;
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/original";

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

export interface IMusicDetailBackdropLookup {
    searchArtist: (artist: string) => Promise<string | undefined>;
}

const artworkCache = new Map<string, IArtworkCacheEntry>();
const inFlightLookups = new Map<string, Promise<string | undefined>>();
const backdropCache = new Map<string, IArtworkCacheEntry>();
const inFlightBackdropLookups = new Map<
    string,
    Promise<string | undefined>
>();

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
    if (typeof artwork !== "string") {
        return false;
    }
    const uri = artwork.trim();
    return (
        uri.length > 0 &&
        /^(https?:|file:|content:|data:image\/|asset:|ph:)/i.test(uri)
    );
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
                artwork: item.artwork.trim(),
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
                .then(value => finish(value), () => finish(undefined));
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
    return undefined;
}

function readTmdbCredentials() {
    const readAccessToken = process.env.EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN?.trim();
    const apiKey = process.env.EXPO_PUBLIC_TMDB_API_KEY?.trim();
    return { readAccessToken, apiKey };
}

function getPrimaryArtist(artist?: string) {
    return (artist ?? "")
        .split(/[,，/&、;；]/u)[0]
        ?.trim();
}

function createTmdbBackdropLookup(): IMusicDetailBackdropLookup | undefined {
    const { readAccessToken, apiKey } = readTmdbCredentials();
    if (!readAccessToken && !apiKey) {
        return undefined;
    }

    return {
        searchArtist: async artist => {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                TMDB_REQUEST_TIMEOUT_MS,
            );
            try {
                const query = [
                    `query=${encodeURIComponent(artist)}`,
                    "include_adult=false",
                    "language=zh-CN",
                    "page=1",
                    ...(apiKey
                        ? [`api_key=${encodeURIComponent(apiKey)}`]
                        : []),
                ].join("&");
                const response = await fetch(
                    `https://api.themoviedb.org/3/search/person?${query}`,
                    {
                        signal: controller.signal,
                        headers: {
                            accept: "application/json",
                            ...(readAccessToken
                                ? {
                                    authorization: `Bearer ${readAccessToken}`,
                                }
                                : {}),
                        },
                    },
                );
                if (!response.ok) {
                    return undefined;
                }
                const payload = (await response.json()) as {
                    results?: Array<{
                        name?: string;
                        original_name?: string;
                        profile_path?: string | null;
                        popularity?: number;
                    }>;
                };
                const expected = normalizeMatchText(artist);
                const candidate = (payload.results ?? [])
                    .filter(item => item.profile_path)
                    .map(item => {
                        const names = [item.name, item.original_name]
                            .map(normalizeMatchText)
                            .filter(Boolean);
                        const exact = names.some(name => name === expected);
                        const compatible = names.some(
                            name =>
                                name.includes(expected) ||
                                expected.includes(name),
                        );
                        return {
                            ...item,
                            score:
                                (exact ? 2_000 : compatible ? 1_000 : 0) +
                                Math.min(999, Number(item.popularity) || 0),
                        };
                    })
                    .filter(item => item.score >= 1_000)
                    .sort((a, b) => b.score - a.score)[0];
                return candidate?.profile_path
                    ? `${TMDB_IMAGE_BASE_URL}${candidate.profile_path}`
                    : undefined;
            } finally {
                clearTimeout(timeout);
            }
        },
    };
}

/**
 * 只供播放详情页调用。查询结果仅保存在内存中，不修改播放队列或持久化状态。
 */
export function resolveMusicDetailArtwork(
    musicItem: IMusic.IMusicItem,
    lookup?: IMusicDetailArtworkLookup,
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

/**
 * 可选 TMDB 艺人背景，只作为播放详情页 hero/backdrop 使用。它不会回写歌曲
 * artwork，也不会进入列表、通知栏或持久化缓存。
 */
export function resolveMusicDetailBackdrop(
    musicItem: IMusic.IMusicItem,
    lookup: IMusicDetailBackdropLookup | undefined = createTmdbBackdropLookup(),
) {
    const artist = getPrimaryArtist(musicItem.artist);
    const key = normalizeMatchText(artist);
    if (!artist || !key || !lookup) {
        return Promise.resolve(undefined);
    }

    const now = Date.now();
    const cached = backdropCache.get(key);
    if (cached && cached.expiresAt > now) {
        cached.lastAccessedAt = now;
        return Promise.resolve(cached.artwork);
    }
    if (cached) {
        backdropCache.delete(key);
    }

    const inFlight = inFlightBackdropLookups.get(key);
    if (inFlight) {
        return inFlight;
    }

    const deadline = Date.now() + TMDB_REQUEST_TIMEOUT_MS;
    const task = withDeadline(() => lookup.searchArtist(artist), deadline)
        .catch(() => undefined)
        .then(backdrop => {
            const safeBackdrop =
                typeof backdrop === "string" &&
                backdrop.startsWith("https://image.tmdb.org/")
                    ? backdrop
                    : undefined;
            const resolvedAt = Date.now();
            backdropCache.set(key, {
                artwork: safeBackdrop,
                expiresAt:
                    resolvedAt +
                    (safeBackdrop
                        ? BACKDROP_SUCCESS_CACHE_TTL_MS
                        : BACKDROP_FAILURE_CACHE_TTL_MS),
                lastAccessedAt: resolvedAt,
            });
            trimCache(
                backdropCache,
                MAX_BACKDROP_CACHE_ENTRIES,
                resolvedAt,
            );
            return safeBackdrop;
        })
        .finally(() => {
            if (inFlightBackdropLookups.get(key) === task) {
                inFlightBackdropLookups.delete(key);
            }
        });

    inFlightBackdropLookups.set(key, task);
    return task;
}

export function resetMusicDetailArtworkCacheForTests() {
    artworkCache.clear();
    inFlightLookups.clear();
    backdropCache.clear();
    inFlightBackdropLookups.clear();
    activeLookupCount = 0;
    lookupWaiters.splice(0, lookupWaiters.length).forEach(waiter => {
        clearTimeout(waiter.timeout);
        waiter.resolve(false);
    });
}
