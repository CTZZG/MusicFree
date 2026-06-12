import { localPluginPlatform } from "@/constants/commonConst";
import { convertLegacyQuality } from "@/utils/qualities";
import { ILxMusicInfo, ILxQuality, ILxSourceKey } from "./types";

const platformAliasMap: Array<{
    key: ILxSourceKey;
    aliases: string[];
}> = [
    {
        key: "kw",
        aliases: ["kw", "kuwo", "酷我"],
    },
    {
        key: "kg",
        aliases: ["kg", "kugou", "酷狗"],
    },
    {
        key: "tx",
        aliases: ["tx", "qq", "qqmusic", "tencent", "腾讯", "QQ音乐"],
    },
    {
        key: "wy",
        aliases: ["wy", "netease", "163", "网易", "网易云", "网易云音乐"],
    },
    {
        key: "mg",
        aliases: ["mg", "migu", "咪咕"],
    },
    {
        key: "local",
        aliases: ["local", localPluginPlatform, "本地"],
    },
];

const lxQualityMap: Record<string, ILxQuality> = {
    "96k": "128k",
    "128k": "128k",
    "192k": "128k",
    "320k": "320k",
    flac: "flac",
    flac24bit: "flac24bit",
    hires: "flac24bit",
    vinyl: "flac24bit",
    dolby: "flac24bit",
    atmos: "flac24bit",
    atmos_plus: "flac24bit",
    master: "flac24bit",
};

function normalizePlatformText(platform?: string) {
    return String(platform ?? "")
        .trim()
        .replace(/\s+/g, "")
        .toLowerCase();
}

export function mapMusicFreePlatformToLx(platform?: string): ILxSourceKey | null {
    const normalized = normalizePlatformText(platform);
    if (!normalized) {
        return null;
    }

    for (const item of platformAliasMap) {
        if (item.aliases.some(alias => normalizePlatformText(alias) === normalized)) {
            return item.key;
        }
    }

    return null;
}

export function mapMusicFreeQualityToLx(
    quality: IMusic.IQualityKey,
): ILxQuality {
    return lxQualityMap[convertLegacyQuality(quality)] ?? "320k";
}

function formatDuration(seconds?: number) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds ?? 0)));
    if (!safeSeconds) {
        return undefined;
    }
    const minutes = Math.floor(safeSeconds / 60);
    const rest = safeSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

function getQualityTypes(musicItem: IMusic.IMusicItemBase) {
    const qualityEntries = Object.entries(musicItem.qualities ?? {});
    const sourceEntries = Object.entries(musicItem.source ?? {});
    const rawEntries = qualityEntries.length ? qualityEntries : sourceEntries;
    const types: ILxMusicInfo["types"] = rawEntries
        .map(([key, value]) => ({
            type: lxQualityMap[convertLegacyQuality(key)],
            size: (value as any)?.size ?? null,
            hash: (value as any)?.hash,
        }))
        .filter(item => Boolean(item.type));

    if (types.length) {
        const seen = new Set<string>();
        return types.filter(item => {
            if (seen.has(item.type)) {
                return false;
            }
            seen.add(item.type);
            return true;
        });
    }

    return [
        {
            type: "128k" as const,
            size: null,
        },
        {
            type: "320k" as const,
            size: null,
        },
        {
            type: "flac" as const,
            size: null,
        },
    ];
}

function pickFirstString(raw: any, keys: string[]) {
    for (const key of keys) {
        const value = raw?.[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value);
        }
    }
    return undefined;
}

export function convertMusicFreeItemToLxMusicInfo(
    musicItem: IMusic.IMusicItemBase,
): ILxMusicInfo | null {
    const source = mapMusicFreePlatformToLx(musicItem.platform);
    if (!source) {
        return null;
    }

    const raw = musicItem as any;
    const musicInfo: ILxMusicInfo = {
        name: String(musicItem.title ?? ""),
        singer: String(musicItem.artist ?? ""),
        source,
        songmid: musicItem.id ?? "",
        img: musicItem.artwork,
        albumName: musicItem.album,
        interval: formatDuration(musicItem.duration),
        types: getQualityTypes(musicItem),
    };

    const albumId = pickFirstString(raw, ["albumId", "albumMid", "albummid"]);
    if (albumId) {
        musicInfo.albumId = albumId;
    }
    const hash = pickFirstString(raw, ["hash", "songHash", "fileHash"]);
    if (hash) {
        musicInfo.hash = hash;
        musicInfo.types = musicInfo.types.map(item => ({
            ...item,
            hash: item.hash ?? hash,
        }));
    }
    const strMediaMid = pickFirstString(raw, ["strMediaMid", "mediaMid", "media_mid", "songmid"]);
    if (strMediaMid) {
        musicInfo.strMediaMid = strMediaMid;
    }
    const albumMid = pickFirstString(raw, ["albumMid", "albummid"]);
    if (albumMid) {
        musicInfo.albumMid = albumMid;
    }
    const copyrightId = pickFirstString(raw, ["copyrightId", "copyright_id"]);
    if (copyrightId) {
        musicInfo.copyrightId = copyrightId;
    }
    const lrcUrl = pickFirstString(raw, ["lrcUrl", "lyricUrl"]);
    if (lrcUrl) {
        musicInfo.lrcUrl = lrcUrl;
    }
    const trcUrl = pickFirstString(raw, ["trcUrl"]);
    if (trcUrl) {
        musicInfo.trcUrl = trcUrl;
    }
    const mrcUrl = pickFirstString(raw, ["mrcUrl"]);
    if (mrcUrl) {
        musicInfo.mrcUrl = mrcUrl;
    }

    return musicInfo;
}
