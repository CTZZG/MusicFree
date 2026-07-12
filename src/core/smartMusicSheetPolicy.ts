import type { IMusicPlayStat } from "@/types/core/musicHistory";

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

interface IBuildSmartSheetSnapshotOptions {
    history: IMusic.IMusicItem[];
    playStats: Record<string, IMusicPlayStat>;
    localMusicList: IMusic.IMusicItem[];
    downloadedMusicList: IMusic.IMusicItem[];
    localPluginPlatform: string;
    sheets: IMusic.IMusicSheetItem[];
    now?: number;
}

function normalizeFacetValue(value?: string | null) {
    return `${value ?? ""}`.trim();
}

function getMediaUniqueKey(mediaItem: ICommon.IMediaBase) {
    return `${mediaItem.platform}@${mediaItem.id}`;
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

export function buildSmartSheetLibrarySnapshot(
    options: IBuildSmartSheetSnapshotOptions,
): ISmartSheetLibrarySnapshot {
    const now = options.now ?? Date.now();
    const sheetMusic = options.sheets.flatMap(sheet => sheet.musicList ?? []);
    const favorite = dedupeMusicList(
        options.sheets.find(sheet => sheet.id === "favorite")?.musicList ?? [],
    );
    const favoriteKeys = new Set(favorite.map(getMediaUniqueKey));
    const localKeys = new Set(options.localMusicList.map(getMediaUniqueKey));
    const sheetKeys = new Set(sheetMusic.map(getMediaUniqueKey));
    const known = dedupeMusicList([
        ...options.history,
        ...options.localMusicList,
        ...sheetMusic,
    ]);

    const trackScores = new Map<string, number>();
    for (const musicItem of known) {
        const key = getMediaUniqueKey(musicItem);
        const stat = options.playStats[key];
        const score =
            Math.log2((stat?.count ?? 0) + 1) * 34 +
            getRecencyScore(stat?.lastPlayedAt ?? 0, now) +
            (favoriteKeys.has(key) ? 28 : 0) +
            (localKeys.has(key) ? 8 : 0) +
            (sheetKeys.has(key) ? 6 : 0) +
            getRecentlyAddedScore(Number(musicItem.$timestamp) || 0, now);
        trackScores.set(key, score);
    }

    const rankedMusic = [...known].sort((a, b) => {
        const leftKey = getMediaUniqueKey(a);
        const rightKey = getMediaUniqueKey(b);
        return (
            (trackScores.get(rightKey) ?? 0) -
                (trackScores.get(leftKey) ?? 0) ||
            Number(b.$timestamp ?? 0) - Number(a.$timestamp ?? 0)
        );
    });

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

    const mostPlayed = Object.values(options.playStats)
        .filter(stat => stat?.musicItem && stat.count > 0)
        .sort(
            (a, b) =>
                b.count - a.count || b.lastPlayedAt - a.lastPlayedAt,
        )
        .map(stat => stat.musicItem);

    return {
        recentPlayed: options.history,
        recentAdded: dedupeMusicList(
            [...sheetMusic]
                .filter(musicItem => Number(musicItem.$timestamp) > 0)
                .sort(
                    (a, b) =>
                        Number(b.$timestamp) - Number(a.$timestamp) ||
                        (b.$sortIndex ?? 0) - (a.$sortIndex ?? 0),
                ),
        ),
        mostPlayed,
        recommended: diversifyRecommendations(rankedMusic),
        favorite,
        local: options.localMusicList,
        downloaded: dedupeMusicList(options.downloadedMusicList),
        known,
        artistFacets: buildFacets(byArtist, trackScores),
        albumFacets: buildFacets(byAlbum, trackScores),
        sourceFacets: buildFacets(bySource, trackScores),
        byArtist,
        byAlbum,
        bySource,
    };
}
