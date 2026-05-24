/**
 * 音质相关的所有工具代码
 */
import { ILanguageData } from "@/types/core/i18n";
import { devLog } from "@/utils/log";

type LegacyQualityKey = "low" | "standard" | "high" | "super";

export const BUILTIN_QUALITY_KEYS: string[] = [
    "96k",
    "128k",
    "192k",
    "320k",
    "flac",
    "flac24bit",
    "hires",
    "vinyl",
    "dolby",
    "atmos",
    "atmos_plus",
    "master",
];

/** @deprecated 使用 getQualityKeys() 代替 */
export const qualityKeys = BUILTIN_QUALITY_KEYS;

const legacyQualityMap: Record<LegacyQualityKey, IMusic.IQualityKey> = {
    low: "128k",
    standard: "192k",
    high: "320k",
    super: "flac",
};

const modernToLegacyQualityMap: Record<string, LegacyQualityKey> = {
    "96k": "low",
    "128k": "low",
    "192k": "standard",
    "320k": "high",
    flac: "super",
    flac24bit: "super",
    hires: "super",
    vinyl: "super",
    dolby: "super",
    atmos: "super",
    atmos_plus: "super",
    master: "super",
};

export function isLegacyQuality(quality: string): quality is LegacyQualityKey {
    return quality in legacyQualityMap;
}

export function convertLegacyQuality(quality: string): IMusic.IQualityKey {
    return isLegacyQuality(quality) ? legacyQualityMap[quality] : quality;
}

export function convertToLegacyQuality(quality: string): LegacyQualityKey | undefined {
    if (isLegacyQuality(quality)) {
        return quality;
    }
    return modernToLegacyQualityMap[quality];
}

export function getQualityKeys(): string[] {
    try {
        const Config = require("@/core/appConfig").default;
        const list = Config.getConfig("basic.qualityKeysList");
        if (Array.isArray(list) && list.length > 0) {
            return list.map(convertLegacyQuality);
        }
    } catch {}
    return BUILTIN_QUALITY_KEYS;
}

export function getTryQualityList(): string[] {
    return [...getQualityKeys()].reverse();
}

function normalizeQualityRecord<T extends Record<string, any>>(qualities?: T): T | undefined {
    if (!qualities || typeof qualities !== "object") {
        return undefined;
    }

    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(qualities)) {
        if (value !== undefined && value !== null) {
            normalized[convertLegacyQuality(key)] = value;
        }
    }

    return Object.keys(normalized).length > 0 ? normalized as T : undefined;
}

export function normalizePluginQualities(qualities?: any): IMusic.IQuality | undefined {
    return normalizeQualityRecord(qualities);
}

export const TRY_QUALITYS_LIST: IMusic.IQualityKey[] = [
    "master",
    "atmos_plus",
    "atmos",
    "dolby",
    "vinyl",
    "hires",
    "flac24bit",
    "flac",
    "320k",
    "192k",
    "128k",
    "96k",
];

export const qualityText: Record<string, string> = {
    low: "低音质",
    standard: "标准音质",
    high: "高音质",
    super: "超高音质",
    "96k": "低清音质 96K",
    "128k": "普通音质 128K",
    "192k": "中等音质 192K",
    "320k": "高清音质 320K",
    flac: "高清音质 FLAC",
    flac24bit: "无损音质 FLAC Hires",
    hires: "无损音质 Hires",
    vinyl: "无损音质 Vinyl",
    dolby: "无损音质 Dolby",
    atmos: "无损音质 Atmos",
    atmos_plus: "无损音质 Atmos 2.0",
    master: "无损音质 Master",
};

export function getQualityText(
    i18nData: ILanguageData,
    customTranslations?: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of [...Object.keys(legacyQualityMap), ...getQualityKeys()]) {
        result[key] =
            customTranslations?.[key] ||
            (i18nData as any)[`quality.${key}`] ||
            (i18nData as any)[`musicQuality.${key}`] ||
            qualityText[key] ||
            key.toUpperCase();
    }
    return result;
}

export const builtinQualityAbbr: Record<string, string> = {
    low: "LQ",
    standard: "MQ",
    high: "HQ",
    super: "SQ",
    "96k": "LQ",
    "128k": "LQ",
    "192k": "MQ",
    "320k": "HQ",
    flac: "SQ",
    flac24bit: "HR",
    hires: "HR",
    vinyl: "VN",
    dolby: "DB",
    atmos: "AT",
    atmos_plus: "A+",
    master: "MS",
};

export function getQualityAbbr(
    key: string,
    customAbbreviations?: Record<string, string>,
): string {
    if (customAbbreviations?.[key]) {
        return customAbbreviations[key];
    }
    try {
        const Config = require("@/core/appConfig").default;
        const saved = Config.getConfig("basic.qualityAbbreviations");
        if (saved?.[key]) {
            return saved[key];
        }
    } catch {}
    return builtinQualityAbbr[key] || key.slice(0, 2).toUpperCase();
}

export function getSmartQuality(
    preferredQuality: IMusic.IQualityKey,
    availableQualities: IMusic.IQuality | undefined,
    platformSupportedQualities?: IMusic.IQualityKey[],
): IMusic.IQualityKey {
    const normalizedPreferredQuality = convertLegacyQuality(preferredQuality);
    if (!availableQualities) {
        return normalizedPreferredQuality;
    }

    const normalizedAvailableQualities = normalizePluginQualities(availableQualities);
    const tryList = getTryQualityList();
    const preferredIndex = tryList.indexOf(normalizedPreferredQuality);
    const startIndex = preferredIndex === -1 ? 0 : preferredIndex;

    for (let i = startIndex; i < tryList.length; i++) {
        const quality = tryList[i];
        const hasQuality =
            normalizedAvailableQualities?.[quality] !== undefined &&
            normalizedAvailableQualities?.[quality] !== null;
        const platformSupported =
            !platformSupportedQualities ||
            platformSupportedQualities.map(convertLegacyQuality).includes(quality);

        if (hasQuality && platformSupported) {
            return quality;
        }
    }

    for (let i = startIndex - 1; i >= 0; i--) {
        const quality = tryList[i];
        const hasQuality =
            normalizedAvailableQualities?.[quality] !== undefined &&
            normalizedAvailableQualities?.[quality] !== null;
        const platformSupported =
            !platformSupportedQualities ||
            platformSupportedQualities.map(convertLegacyQuality).includes(quality);

        if (hasQuality && platformSupported) {
            return quality;
        }
    }

    return "128k";
}

/** 获取音质顺序 */
export function getQualityOrder(
    qualityKey: IMusic.IQualityKey,
    sort: "asc" | "desc",
) {
    const keys = getQualityKeys();
    const normalizedQualityKey = convertLegacyQuality(qualityKey);
    const idx = keys.indexOf(normalizedQualityKey);
    const safeQualityKey = idx === -1
        ? keys.includes("320k") ? "320k" : keys[0] ?? normalizedQualityKey
        : normalizedQualityKey;
    const safeIdx = keys.indexOf(safeQualityKey);
    const left = keys.slice(0, safeIdx);
    const right = keys.slice(safeIdx + 1);
    if (sort === "asc") {
        /** 优先高音质 */
        return [safeQualityKey, ...right, ...left.reverse()];
    } else {
        /** 优先低音质 */
        return [safeQualityKey, ...left.reverse(), ...right];
    }
}

const qualityTextToKeyMap: Record<string, IMusic.IQualityKey> = {
    low: "128k",
    standard: "192k",
    high: "320k",
    super: "flac",
    "低音质": "96k",
    "标准音质": "192k",
    "高音质": "320k",
    "超高音质": "flac",
    "臻品母带": "master",
    "臻品全景声2.0": "atmos_plus",
    "臻品全景声": "atmos",
    "臻品音质2.0": "atmos",
    "杜比全景声": "dolby",
    "Hires无损24-Bit": "hires",
    FLAC: "flac",
    "320K": "320k",
    "192K": "192k",
    "128K": "128k",
    mgg: "96k",
    flac24bit: "flac24bit",
    flac: "flac",
    "320k": "320k",
    "192k": "192k",
    "128k": "128k",
    master: "master",
    dolby: "dolby",
    atmos: "atmos",
    atmos_plus: "atmos_plus",
    hires: "hires",
    vinyl: "vinyl",
    "无损": "flac",
    "高品质": "320k",
    "中等": "192k",
    "标准": "128k",
    "超高品质": "hires",
    "母带": "master",
    "黑胶": "vinyl",
};

export function convertApiQualityToQualities(apiQuality?: {
    target?: string;
    result?: string;
    size?: string | number;
    [key: string]: any;
}): IMusic.IQuality | undefined {
    if (!apiQuality?.result) {
        return undefined;
    }

    const qualityKey = qualityTextToKeyMap[apiQuality.result];
    if (!qualityKey) {
        devLog("warn", "[音质处理] 未知的音质类型", {
            qualityResult: apiQuality.result,
        });
        return undefined;
    }

    return {
        [qualityKey]: {
            url: undefined,
            size: apiQuality.size,
        },
    };
}

export function parseQualityText(inputQualityText: string): IMusic.IQualityKey | null {
    return qualityTextToKeyMap[inputQualityText] || null;
}

export function transformMusicItemWithQuality<T extends Partial<IMusic.IMusicItem>>(
    rawMusicItem: T,
    apiQualityData?: { target?: string; result?: string; [key: string]: any },
): T & { qualities?: IMusic.IQuality } {
    const convertedQualities = convertApiQualityToQualities(apiQualityData);

    return {
        ...rawMusicItem,
        qualities: convertedQualities,
    };
}

export function buildQualitiesFromArray(qualityArray: Array<{
    type: string;
    size?: string | number;
    url?: string;
    [key: string]: any;
}>): IMusic.IQuality {
    const qualities: IMusic.IQuality = {};

    for (const qualityInfo of qualityArray) {
        const qualityKey = qualityTextToKeyMap[qualityInfo.type];
        if (qualityKey) {
            qualities[qualityKey] = {
                url: qualityInfo.url,
                size: qualityInfo.size,
            };
        }
    }

    return qualities;
}

export function getAvailableQualities(
    musicItem: IMusic.IMusicItem,
    plugin?: { supportedQualities?: IMusic.IQualityKey[] },
): IMusic.IQualityKey[] {
    const availableQualities: IMusic.IQualityKey[] = [];
    const normalizedQualities = normalizePluginQualities(musicItem.qualities);
    const normalizedSource = normalizeQualityRecord(musicItem.source);

    if (normalizedQualities) {
        const candidates = plugin?.supportedQualities?.length
            ? plugin.supportedQualities.map(convertLegacyQuality)
            : getQualityKeys();
        for (const quality of candidates) {
            if (normalizedQualities[quality] !== undefined) {
                availableQualities.push(quality);
            }
        }
    }

    if (availableQualities.length === 0 && normalizedSource) {
        for (const quality of getQualityKeys()) {
            if (
                normalizedSource[quality] &&
                (normalizedSource[quality]!.url ||
                    normalizedSource[quality]!.size !== undefined)
            ) {
                availableQualities.push(quality);
            }
        }
    }

    if (availableQualities.length === 0) {
        if (plugin?.supportedQualities && plugin.supportedQualities.length > 0) {
            return plugin.supportedQualities.map(convertLegacyQuality);
        }
        return ["128k", "320k", "flac"];
    }

    return availableQualities;
}

export function getQualitySize(
    musicItem: IMusic.IMusicItem,
    quality: IMusic.IQualityKey,
): string | number | undefined {
    const normalizedQuality = convertLegacyQuality(quality);
    const normalizedQualities = normalizePluginQualities(musicItem.qualities);
    const normalizedSource = normalizeQualityRecord(musicItem.source);

    return (
        normalizedQualities?.[normalizedQuality]?.size ||
        normalizedSource?.[normalizedQuality]?.size
    );
}

export function normalizePluginQualityInfo(
    musicItem: any,
    pluginQualityMapping?: Record<string, IMusic.IQualityKey>,
): IMusic.IQuality | undefined {
    if (musicItem.qualities && typeof musicItem.qualities === "object") {
        const normalized = normalizePluginQualities(musicItem.qualities);
        if (normalized && Object.keys(normalized).length > 0) {
            return normalized;
        }
    }

    const qualities: Partial<IMusic.IQuality> = {};

    if (musicItem.l || musicItem.m || musicItem.h || musicItem.sq) {
        if (musicItem.l?.size) qualities["128k"] = { size: musicItem.l.size };
        if (musicItem.m?.size) qualities["192k"] = { size: musicItem.m.size };
        if (musicItem.h?.size) qualities["320k"] = { size: musicItem.h.size };
        if (musicItem.sq?.size) qualities.flac = { size: musicItem.sq.size };
    }

    if (Array.isArray(musicItem.qualityList)) {
        for (const qualityInfo of musicItem.qualityList) {
            const standardKey =
                qualityTextToKeyMap[qualityInfo.type] ||
                pluginQualityMapping?.[qualityInfo.type];
            if (standardKey) {
                qualities[standardKey] = {
                    url: qualityInfo.url,
                    size: qualityInfo.size || qualityInfo.fileSize,
                };
            }
        }
    }

    for (const key of Object.keys(legacyQualityMap)) {
        if (musicItem[key] && typeof musicItem[key] === "object") {
            const standardKey = qualityTextToKeyMap[key];
            if (standardKey && (musicItem[key].size || musicItem[key].url)) {
                qualities[standardKey] = {
                    size: musicItem[key].size,
                    url: musicItem[key].url,
                };
            }
        }
    }

    return Object.keys(qualities).length > 0 ? qualities as IMusic.IQuality : undefined;
}

export function normalizePluginMusicItem<T extends Partial<IMusic.IMusicItem>>(
    rawMusicItem: T,
    pluginQualityMapping?: Record<string, IMusic.IQualityKey>,
): T & { qualities?: IMusic.IQuality; source?: Partial<Record<IMusic.IQualityKey, IMusic.IMediaSource>> } {
    const normalizedQualities = normalizePluginQualityInfo(rawMusicItem, pluginQualityMapping);
    const normalizedSource = normalizeQualityRecord(rawMusicItem.source);

    return {
        ...rawMusicItem,
        ...(normalizedQualities ? { qualities: normalizedQualities } : {}),
        ...(normalizedSource ? { source: normalizedSource } : {}),
    };
}
