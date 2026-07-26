import minDistance from "@/utils/minDistance";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";

type BuiltinLyricSourceKey = "netease" | "lrclib";

interface IBuiltinLyricExtra {
    source: BuiltinLyricSourceKey;
    remoteId: string;
}

interface ICreateLyricItemParams {
    album?: string;
    artist?: string;
    artwork?: string;
    duration?: number;
    isSync?: boolean | null;
    remoteId: string;
    source: BuiltinLyricSourceKey;
    title?: string;
}

interface INeteaseSearchResponse {
    result?: {
        songs?: INeteaseSong[];
    };
}

interface INeteaseSong {
    album?: {
        name?: string;
        picUrl?: string;
    };
    artists?: Array<{
        name?: string;
    }>;
    duration?: number;
    id: number;
    name?: string;
}

interface INeteaseLyricResponse {
    lrc?: {
        lyric?: string;
    };
    tlyric?: {
        lyric?: string;
    };
    romalrc?: {
        lyric?: string;
    };
}

interface ILrcLibSearchItem {
    albumName?: string;
    artistName?: string;
    duration?: number;
    id: number;
    name?: string;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
}

interface ILrcLibTrackResponse extends ILrcLibSearchItem {
    instrumental?: boolean;
}

const NETEASE_SEARCH_URL = "https://music.163.com/api/search/get";
const NETEASE_LYRIC_URL = "https://music.163.com/api/song/lyric";
const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const LRCLIB_GET_URL = "https://lrclib.net/api/get";
const SEARCH_PAGE_SIZE = 8;
const REQUEST_TIMEOUT_MS = 7000;
const builtinLyricHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 2 * 1024 * 1024,
    maxTimeoutMs: REQUEST_TIMEOUT_MS,
});

const builtinLyricHeaders = {
    "User-Agent": "MusicFree/0.6 builtin lyric source",
};

const neteaseHeaders = {
    ...builtinLyricHeaders,
    Referer: "https://music.163.com/",
};

export const builtinLyricPluginPlatforms = {
    netease: "NetEase Lyrics",
    lrclib: "LRCLIB Lyrics",
};

function normalizeText(text?: string | number | null) {
    return `${text ?? ""}`
        .toLowerCase()
        .replace(/[\s\-_.·・,，、/\\|｜&()（）[\]【】《》<>]/g, "");
}

function getResultScore(query: string, item: ILyric.ILyricItem) {
    const normalizedQuery = normalizeText(query);
    const normalizedTitle = normalizeText(item.title);
    const normalizedArtist = normalizeText(item.artist);
    const normalizedCombined = normalizeText(`${item.title}${item.artist}`);

    if (!normalizedQuery) {
        return 0;
    }

    const titleDistance =
        minDistance(normalizedQuery, normalizedTitle) /
        Math.max(normalizedQuery.length, normalizedTitle.length, 1);
    const combinedDistance =
        minDistance(normalizedQuery, normalizedCombined) /
        Math.max(normalizedQuery.length, normalizedCombined.length, 1);

    let score = Math.min(titleDistance, combinedDistance + 0.08);
    if (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedTitle)
    ) {
        score -= 0.25;
    }
    if (normalizedArtist && normalizedQuery.includes(normalizedArtist)) {
        score -= 0.1;
    }
    if (item.$?.builtinLyric?.isSync) {
        score -= 0.03;
    }

    return score;
}

function rankLyricItems(query: string, items: ILyric.ILyricItem[]) {
    return items
        .map((item, index) => ({
            item,
            index,
            score: getResultScore(query, item),
        }))
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map(it => it.item);
}

function createLyricItem(params: ICreateLyricItemParams): ILyric.ILyricItem {
    const platform = builtinLyricPluginPlatforms[params.source];
    return {
        id: `${params.source}:${params.remoteId}`,
        platform,
        title: params.title?.trim() || "未知标题",
        artist: params.artist?.trim() || "未知歌手",
        album: params.album?.trim() || "未知专辑",
        artwork: params.artwork ?? "",
        duration: params.duration ?? 0,
        $: {
            builtinLyric: {
                source: params.source,
                remoteId: params.remoteId,
                isSync: params.isSync,
            },
        },
    };
}

function parseBuiltinLyricExtra(
    musicItem: IMusic.IMusicItemBase,
): IBuiltinLyricExtra | null {
    const extra = musicItem.$?.builtinLyric as
        | (IBuiltinLyricExtra & { isSync?: boolean | null })
        | undefined;
    if (extra?.source && extra.remoteId) {
        return {
            source: extra.source,
            remoteId: extra.remoteId,
        };
    }

    const id = String(musicItem.id ?? "");
    const [source, ...remoteIdParts] = id.split(":");
    const remoteId = remoteIdParts.join(":");
    if (
        (source === "netease" || source === "lrclib") &&
        remoteId
    ) {
        return {
            source,
            remoteId,
        };
    }

    return null;
}

function emptyLyricSearchResult(): IPlugin.ISearchResult<"lyric"> {
    return {
        isEnd: true,
        data: [],
    };
}

function asGenericSearchResult<T extends ICommon.SupportMediaType>(
    result: IPlugin.ISearchResult<"lyric">,
): IPlugin.ISearchResult<T> {
    return result as unknown as IPlugin.ISearchResult<T>;
}

async function searchNeteaseLyrics(
    query: string,
): Promise<IPlugin.ISearchResult<"lyric">> {
    if (!query.trim()) {
        return emptyLyricSearchResult();
    }

    try {
        const response = await builtinLyricHttpClient.get(
            NETEASE_SEARCH_URL,
            {
                headers: neteaseHeaders,
                params: {
                    limit: SEARCH_PAGE_SIZE,
                    offset: 0,
                    s: query,
                    type: "1",
                },
                timeout: REQUEST_TIMEOUT_MS,
            },
        );
        const songs =
            (response.data as INeteaseSearchResponse).result?.songs ?? [];
        const data = songs.map(song =>
            createLyricItem({
                source: "netease",
                remoteId: String(song.id),
                title: song.name,
                artist: song.artists
                    ?.map(artist => artist.name)
                    .filter(Boolean)
                    .join(", "),
                album: song.album?.name,
                artwork: song.album?.picUrl,
                duration: song.duration ? song.duration / 1000 : 0,
                isSync: true,
            }),
        );

        return {
            isEnd: true,
            data: rankLyricItems(query, data),
        };
    } catch {
        return emptyLyricSearchResult();
    }
}

async function getNeteaseLyric(
    musicItem: IMusic.IMusicItemBase,
): Promise<ILyric.ILyricSource | null> {
    const extra = parseBuiltinLyricExtra(musicItem);
    if (extra?.source !== "netease" || !extra.remoteId) {
        return null;
    }

    try {
        const response = await builtinLyricHttpClient.get(
            NETEASE_LYRIC_URL,
            {
                headers: neteaseHeaders,
                params: {
                    id: extra.remoteId,
                    kv: "-1",
                    lv: "-1",
                    rv: "-1",
                    tv: "-1",
                },
                timeout: REQUEST_TIMEOUT_MS,
            },
        );
        const responseData = response.data as INeteaseLyricResponse;
        const rawLrc = responseData.lrc?.lyric?.trim();
        const translation = responseData.tlyric?.lyric?.trim();
        const romanization = responseData.romalrc?.lyric?.trim();

        if (!rawLrc && !translation && !romanization) {
            return null;
        }

        return {
            rawLrc: rawLrc || undefined,
            translation: translation || undefined,
            romanization: romanization || undefined,
            sourcePluginName: "NetEase",
            sourceTitle: musicItem.title,
        };
    } catch {
        return null;
    }
}

async function searchLrcLibLyrics(
    query: string,
): Promise<IPlugin.ISearchResult<"lyric">> {
    if (!query.trim()) {
        return emptyLyricSearchResult();
    }

    try {
        const response = await builtinLyricHttpClient.get(
            LRCLIB_SEARCH_URL,
            {
                headers: builtinLyricHeaders,
                params: {
                    q: query,
                },
                timeout: REQUEST_TIMEOUT_MS,
            },
        );
        const data = (
            (response.data as ILrcLibSearchItem[] | undefined) ?? []
        )
            .slice(0, SEARCH_PAGE_SIZE)
            .map(item =>
                createLyricItem({
                    source: "lrclib",
                    remoteId: String(item.id),
                    title: item.name,
                    artist: item.artistName,
                    album: item.albumName,
                    duration: item.duration,
                    isSync: !!item.syncedLyrics,
                }),
            );

        return {
            isEnd: true,
            data: rankLyricItems(query, data),
        };
    } catch {
        return emptyLyricSearchResult();
    }
}

async function getLrcLibLyric(
    musicItem: IMusic.IMusicItemBase,
): Promise<ILyric.ILyricSource | null> {
    const extra = parseBuiltinLyricExtra(musicItem);
    if (extra?.source !== "lrclib" || !extra.remoteId) {
        return null;
    }

    try {
        const response = await builtinLyricHttpClient.get(
            `${LRCLIB_GET_URL}/${encodeURIComponent(extra.remoteId)}`,
            {
                headers: builtinLyricHeaders,
                timeout: REQUEST_TIMEOUT_MS,
            },
        );
        const responseData = response.data as ILrcLibTrackResponse;
        const rawLrc =
            responseData.syncedLyrics?.trim() ||
            responseData.plainLyrics?.trim();

        if (!rawLrc) {
            return null;
        }

        return {
            rawLrc,
            sourcePluginName: "lrclib.net",
            sourceTitle: musicItem.title,
        };
    } catch {
        return null;
    }
}

export const neteaseLyricPluginDefine: IPlugin.IPluginDefine = {
    platform: builtinLyricPluginPlatforms.netease,
    version: "0.1.0",
    author: "MusicFree",
    description: "Built-in lyric source adapted from Feishin default providers.",
    supportedSearchType: ["lyric"],
    async search<T extends ICommon.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ) {
        if (type !== "lyric" || page > 1) {
            return asGenericSearchResult<T>(emptyLyricSearchResult());
        }
        return asGenericSearchResult<T>(await searchNeteaseLyrics(query));
    },
    async getLyric(musicItem) {
        return getNeteaseLyric(musicItem);
    },
};

export const lrcLibLyricPluginDefine: IPlugin.IPluginDefine = {
    platform: builtinLyricPluginPlatforms.lrclib,
    version: "0.1.0",
    author: "MusicFree",
    description: "Built-in lyric source adapted from Feishin default providers.",
    supportedSearchType: ["lyric"],
    async search<T extends ICommon.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ) {
        if (type !== "lyric" || page > 1) {
            return asGenericSearchResult<T>(emptyLyricSearchResult());
        }
        return asGenericSearchResult<T>(await searchLrcLibLyrics(query));
    },
    async getLyric(musicItem) {
        return getLrcLibLyric(musicItem);
    },
};
