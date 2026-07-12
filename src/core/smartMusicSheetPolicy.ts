import type { IMusicPlayStat } from "@/types/core/musicHistory";

const smartSheetScoreTimeBucket = 60 * 60 * 1000;

export interface ISmartSheetFacet {
    value: string;
    title: string;
    count: number;
    score: number;
}

export interface ISmartSheetLibrarySnapshot {
    recentPlayed: IMusic.IMusicItem[];
    recentAdded: IMusic.IMusicItem[];
    mostPlayed: IMusic.IMusicItem[];
    recommended: IMusic.IMusicItem[];
    favorite: IMusic.IMusicItem[];
    local: IMusic.IMusicItem[];
    downloaded: IMusic.IMusicItem[];
    known: IMusic.IMusicItem[];
    artistFacets: ISmartSheetFacet[];
    albumFacets: ISmartSheetFacet[];
    sourceFacets: ISmartSheetFacet[];
    byArtist: Map<string, IMusic.IMusicItem[]>;
    byAlbum: Map<string, IMusic.IMusicItem[]>;
    bySource: Map<string, IMusic.IMusicItem[]>;
}

export interface IBuildSmartSheetSnapshotOptions {
    history: IMusic.IMusicItem[];
    playStats: Record<string, IMusicPlayStat>;
    localMusicList: IMusic.IMusicItem[];
    downloadedMusicList: IMusic.IMusicItem[];
    localPluginPlatform: string;
    sheets: IMusic.IMusicSheetItem[];
    now?: number;
}

interface ISmartSheetLibraryIndex {
    recentAdded: IMusic.IMusicItem[];
    favorite: IMusic.IMusicItem[];
    local: IMusic.IMusicItem[];
    downloaded: IMusic.IMusicItem[];
    known: IMusic.IMusicItem[];
    knownByKey: Map<string, IMusic.IMusicItem>;
    favoriteKeys: Set<string>;
    localKeys: Set<string>;
    sheetKeys: Set<string>;
    addedAtByKey: Map<string, number>;
    byArtist: Map<string, IMusic.IMusicItem[]>;
    byAlbum: Map<string, IMusic.IMusicItem[]>;
    bySource: Map<string, IMusic.IMusicItem[]>;
}

interface ISmartSheetDynamicSnapshot {
    mostPlayed: IMusic.IMusicItem[];
    recommended: IMusic.IMusicItem[];
    artistFacets: ISmartSheetFacet[];
    albumFacets: ISmartSheetFacet[];
    sourceFacets: ISmartSheetFacet[];
}

function normalizeFacetValue(value?: string | null) {
    return `${value ?? ""}`.trim();
}

function getMediaUniqueKey(mediaItem: ICommon.IMediaBase) {
    return `${mediaItem.platform}@${mediaItem.id}`;
}

function isBasicMusicItemValid(musicItem: IMusic.IMusicItem | null | undefined) {
    return !!(
        musicItem &&
        normalizeFacetValue(musicItem.id) &&
        normalizeFacetValue(musicItem.platform) &&
        normalizeFacetValue(musicItem.title)
    );
}

function isObviouslyAvailableMusicItem(
    musicItem: IMusic.IMusicItem | null | undefined,
    localPluginPlatform: string,
    localKeys: ReadonlySet<string>,
) {
    if (!isBasicMusicItemValid(musicItem)) {
        return false;
    }
    return (
        musicItem!.platform !== localPluginPlatform ||
        localKeys.has(getMediaUniqueKey(musicItem!))
    );
}

function dedupeMusicList(musicList: IMusic.IMusicItem[]) {
    const seen = new Set<string>();
    const result: IMusic.IMusicItem[] = [];
    for (const musicItem of musicList) {
        const key = getMediaUniqueKey(musicItem);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(musicItem);
        }
    }
    return result;
}

function normalizeTimestamp(value: unknown) {
    if (typeof value === "string" && value.trim() && !Number.isFinite(Number(value))) {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return 0;
    }
    return numericValue < 10_000_000_000
        ? numericValue * 1000
        : numericValue;
}

export function getSmartSheetAddedAt(musicItem: IMusic.IMusicItem) {
    return Math.max(
        normalizeTimestamp(musicItem.$timestamp),
        normalizeTimestamp(musicItem.addedAt),
        normalizeTimestamp(musicItem.createAt),
        normalizeTimestamp(musicItem.createdAt),
    );
}

function getRecencyScore(lastPlayedAt: number, now: number) {
    if (!lastPlayedAt) {
        return 0;
    }
    const ageDays = Math.max(0, now - lastPlayedAt) / 86_400_000;
    return 42 * Math.exp(-ageDays / 21);
}

function getRecentlyAddedScore(timestamp: number, now: number) {
    if (!timestamp) {
        return 0;
    }
    const ageDays = Math.max(0, now - timestamp) / 86_400_000;
    return 16 * Math.exp(-ageDays / 90);
}

function addToGroup(
    groups: Map<string, IMusic.IMusicItem[]>,
    value: string,
    musicItem: IMusic.IMusicItem,
) {
    if (!value) {
        return;
    }
    const current = groups.get(value);
    if (current) {
        current.push(musicItem);
    } else {
        groups.set(value, [musicItem]);
    }
}

function buildFacets(
    groups: Map<string, IMusic.IMusicItem[]>,
    trackScores: Map<string, number>,
) {
    return [...groups.entries()]
        .map(([value, musicList]) => ({
            value,
            title: value,
            count: musicList.length,
            score: musicList.reduce(
                (total, musicItem) =>
                    total + (trackScores.get(getMediaUniqueKey(musicItem)) ?? 0),
                musicList.length * 2,
            ),
        }))
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.count - a.count ||
                a.title.localeCompare(b.title),
        );
}

function diversifyRecommendations(
    rankedMusic: IMusic.IMusicItem[],
    limit = 80,
) {
    const selected: IMusic.IMusicItem[] = [];
    const selectedKeys = new Set<string>();
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();

    for (const musicItem of rankedMusic) {
        const artist = normalizeFacetValue(musicItem.artist);
        const album = normalizeFacetValue(musicItem.album);
        if (
            (artist && (artistCounts.get(artist) ?? 0) >= 3) ||
            (album && (albumCounts.get(album) ?? 0) >= 2)
        ) {
            continue;
        }
        selected.push(musicItem);
        selectedKeys.add(getMediaUniqueKey(musicItem));
        if (artist) {
            artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
        }
        if (album) {
            albumCounts.set(album, (albumCounts.get(album) ?? 0) + 1);
        }
        if (selected.length >= limit) {
            return selected;
        }
    }

    for (const musicItem of rankedMusic) {
        const key = getMediaUniqueKey(musicItem);
        if (!selectedKeys.has(key)) {
            selected.push(musicItem);
            if (selected.length >= limit) {
                break;
            }
        }
    }
    return selected;
}

function buildHistoryLibraryRevision(history: IMusic.IMusicItem[]) {
    return history
        .filter(isBasicMusicItemValid)
        .map(musicItem => [
            getMediaUniqueKey(musicItem),
            normalizeFacetValue(musicItem.title),
            normalizeFacetValue(musicItem.artist),
            normalizeFacetValue(musicItem.album),
            normalizeFacetValue(musicItem.artwork),
            getSmartSheetAddedAt(musicItem),
        ].join("\u0001"))
        .sort()
        .join("\u0002");
}

function buildSmartSheetLibraryIndex(
    options: IBuildSmartSheetSnapshotOptions,
): ISmartSheetLibraryIndex {
    const local = dedupeMusicList(options.localMusicList.filter(isBasicMusicItemValid));
    const localKeys = new Set(local.map(getMediaUniqueKey));
    const isAvailable = (musicItem: IMusic.IMusicItem) =>
        isObviouslyAvailableMusicItem(
            musicItem,
            options.localPluginPlatform,
            localKeys,
        );
    const sheetMusic = options.sheets
        .flatMap(sheet => sheet.musicList ?? [])
        .filter(isAvailable);
    const favorite = dedupeMusicList(
        (options.sheets.find(sheet => sheet.id === "favorite")?.musicList ?? [])
            .filter(isAvailable),
    );
    const downloaded = dedupeMusicList(
        options.downloadedMusicList.filter(isAvailable),
    );
    const validHistory = options.history.filter(isAvailable);
    const known = dedupeMusicList([
        ...validHistory,
        ...local,
        ...sheetMusic,
    ]);
    const knownByKey = new Map(
        known.map(musicItem => [getMediaUniqueKey(musicItem), musicItem]),
    );
    const favoriteKeys = new Set(favorite.map(getMediaUniqueKey));
    const sheetKeys = new Set(sheetMusic.map(getMediaUniqueKey));
    const addedAtByKey = new Map<string, number>();
    for (const musicItem of [...validHistory, ...local, ...sheetMusic, ...downloaded]) {
        const key = getMediaUniqueKey(musicItem);
        addedAtByKey.set(
            key,
            Math.max(addedAtByKey.get(key) ?? 0, getSmartSheetAddedAt(musicItem)),
        );
    }

    const recentAdded = known
        .filter(musicItem => (addedAtByKey.get(getMediaUniqueKey(musicItem)) ?? 0) > 0)
        .sort((a, b) =>
            (addedAtByKey.get(getMediaUniqueKey(b)) ?? 0) -
                (addedAtByKey.get(getMediaUniqueKey(a)) ?? 0) ||
            (b.$sortIndex ?? 0) - (a.$sortIndex ?? 0),
        );
    const byArtist = new Map<string, IMusic.IMusicItem[]>();
    const byAlbum = new Map<string, IMusic.IMusicItem[]>();
    const bySource = new Map<string, IMusic.IMusicItem[]>();
    for (const musicItem of known) {
        addToGroup(byArtist, normalizeFacetValue(musicItem.artist), musicItem);
        addToGroup(byAlbum, normalizeFacetValue(musicItem.album), musicItem);
        const platform = normalizeFacetValue(musicItem.platform);
        if (platform && platform !== options.localPluginPlatform) {
            addToGroup(bySource, platform, musicItem);
        }
    }

    return {
        recentAdded,
        favorite,
        local,
        downloaded,
        known,
        knownByKey,
        favoriteKeys,
        localKeys,
        sheetKeys,
        addedAtByKey,
        byArtist,
        byAlbum,
        bySource,
    };
}

function buildSmartSheetDynamicSnapshot(
    index: ISmartSheetLibraryIndex,
    options: IBuildSmartSheetSnapshotOptions,
    now: number,
): ISmartSheetDynamicSnapshot {
    const trackScores = new Map<string, number>();
    for (const musicItem of index.known) {
        const key = getMediaUniqueKey(musicItem);
        const stat = options.playStats[key];
        const score =
            Math.log2((stat?.count ?? 0) + 1) * 34 +
            getRecencyScore(stat?.lastPlayedAt ?? 0, now) +
            (index.favoriteKeys.has(key) ? 28 : 0) +
            (index.localKeys.has(key) ? 8 : 0) +
            (index.sheetKeys.has(key) ? 6 : 0) +
            getRecentlyAddedScore(index.addedAtByKey.get(key) ?? 0, now);
        trackScores.set(key, score);
    }

    const rankedMusic = [...index.known].sort((a, b) => {
        const leftKey = getMediaUniqueKey(a);
        const rightKey = getMediaUniqueKey(b);
        return (
            (trackScores.get(rightKey) ?? 0) -
                (trackScores.get(leftKey) ?? 0) ||
            (index.addedAtByKey.get(rightKey) ?? 0) -
                (index.addedAtByKey.get(leftKey) ?? 0)
        );
    });

    const mostPlayed = dedupeMusicList(
        Object.values(options.playStats)
            .filter(stat =>
                stat?.musicItem &&
                stat.count > 0 &&
                isObviouslyAvailableMusicItem(
                    stat.musicItem,
                    options.localPluginPlatform,
                    index.localKeys,
                ),
            )
            .sort(
                (a, b) =>
                    b.count - a.count || b.lastPlayedAt - a.lastPlayedAt,
            )
            .map(stat =>
                index.knownByKey.get(getMediaUniqueKey(stat.musicItem)) ??
                stat.musicItem,
            ),
    );

    return {
        mostPlayed,
        recommended: diversifyRecommendations(rankedMusic),
        artistFacets: buildFacets(index.byArtist, trackScores),
        albumFacets: buildFacets(index.byAlbum, trackScores),
        sourceFacets: buildFacets(index.bySource, trackScores),
    };
}

function buildRecentPlayed(
    history: IMusic.IMusicItem[],
    localPluginPlatform: string,
    localKeys: ReadonlySet<string>,
) {
    return dedupeMusicList(
        history.filter(musicItem =>
            isObviouslyAvailableMusicItem(
                musicItem,
                localPluginPlatform,
                localKeys,
            ),
        ),
    );
}

function composeSmartSheetLibrarySnapshot(
    index: ISmartSheetLibraryIndex,
    dynamic: ISmartSheetDynamicSnapshot,
    recentPlayed: IMusic.IMusicItem[],
): ISmartSheetLibrarySnapshot {
    return {
        recentPlayed,
        recentAdded: index.recentAdded,
        mostPlayed: dynamic.mostPlayed,
        recommended: dynamic.recommended,
        favorite: index.favorite,
        local: index.local,
        downloaded: index.downloaded,
        known: index.known,
        artistFacets: dynamic.artistFacets,
        albumFacets: dynamic.albumFacets,
        sourceFacets: dynamic.sourceFacets,
        byArtist: index.byArtist,
        byAlbum: index.byAlbum,
        bySource: index.bySource,
    };
}

function getCacheScoringNow(now?: number) {
    if (now !== undefined) {
        return now;
    }
    const current = Date.now();
    return current - current % smartSheetScoreTimeBucket;
}

export function createSmartSheetLibrarySnapshotCache() {
    let indexEntry: {
        localMusicList: IMusic.IMusicItem[];
        downloadedMusicList: IMusic.IMusicItem[];
        localPluginPlatform: string;
        sheets: IMusic.IMusicSheetItem[];
        historyLibraryRevision: string;
        value: ISmartSheetLibraryIndex;
    } | null = null;
    let dynamicEntry: {
        index: ISmartSheetLibraryIndex;
        playStats: Record<string, IMusicPlayStat>;
        now: number;
        value: ISmartSheetDynamicSnapshot;
    } | null = null;
    let snapshotEntry: {
        history: IMusic.IMusicItem[];
        index: ISmartSheetLibraryIndex;
        dynamic: ISmartSheetDynamicSnapshot;
        value: ISmartSheetLibrarySnapshot;
    } | null = null;

    return {
        get(options: IBuildSmartSheetSnapshotOptions) {
            const historyLibraryRevision = buildHistoryLibraryRevision(options.history);
            if (
                !indexEntry ||
                indexEntry.localMusicList !== options.localMusicList ||
                indexEntry.downloadedMusicList !== options.downloadedMusicList ||
                indexEntry.localPluginPlatform !== options.localPluginPlatform ||
                indexEntry.sheets !== options.sheets ||
                indexEntry.historyLibraryRevision !== historyLibraryRevision
            ) {
                indexEntry = {
                    localMusicList: options.localMusicList,
                    downloadedMusicList: options.downloadedMusicList,
                    localPluginPlatform: options.localPluginPlatform,
                    sheets: options.sheets,
                    historyLibraryRevision,
                    value: buildSmartSheetLibraryIndex(options),
                };
            }

            const index = indexEntry.value;
            const now = getCacheScoringNow(options.now);
            if (
                !dynamicEntry ||
                dynamicEntry.index !== index ||
                dynamicEntry.playStats !== options.playStats ||
                dynamicEntry.now !== now
            ) {
                dynamicEntry = {
                    index,
                    playStats: options.playStats,
                    now,
                    value: buildSmartSheetDynamicSnapshot(index, options, now),
                };
            }

            const dynamic = dynamicEntry.value;
            if (
                snapshotEntry?.history === options.history &&
                snapshotEntry.index === index &&
                snapshotEntry.dynamic === dynamic
            ) {
                return snapshotEntry.value;
            }

            snapshotEntry = {
                history: options.history,
                index,
                dynamic,
                value: composeSmartSheetLibrarySnapshot(
                    index,
                    dynamic,
                    buildRecentPlayed(
                        options.history,
                        options.localPluginPlatform,
                        index.localKeys,
                    ),
                ),
            };
            return snapshotEntry.value;
        },
        clear() {
            indexEntry = null;
            dynamicEntry = null;
            snapshotEntry = null;
        },
    };
}

export function buildSmartSheetLibrarySnapshot(
    options: IBuildSmartSheetSnapshotOptions,
): ISmartSheetLibrarySnapshot {
    const index = buildSmartSheetLibraryIndex(options);
    const dynamic = buildSmartSheetDynamicSnapshot(
        index,
        options,
        options.now ?? Date.now(),
    );
    return composeSmartSheetLibrarySnapshot(
        index,
        dynamic,
        buildRecentPlayed(
            options.history,
            options.localPluginPlatform,
            index.localKeys,
        ),
    );
}
