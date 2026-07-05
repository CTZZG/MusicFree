import { safeParse } from "@/utils/jsonUtil";

export const DEFAULT_MEDIA_CACHE_QUALITY = "default";

const legacyCacheQualityMap: Record<string, string> = {
    low: "128k",
    standard: "192k",
    high: "320k",
    super: "flac",
};

export interface MediaCacheRawRecord {
    key: string;
    raw?: string | null;
}

export interface MediaCacheEntry {
    key: string;
    platform: string;
    id: string;
    title: string;
    artist: string;
    album: string;
    qualityKeys: string[];
    approximateSize: number;
    mediaItem: IMusic.IMusicItemCache;
}

export interface MediaCacheEntryFilter {
    query?: string;
    platform?: string;
    quality?: string;
}

function cleanText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function compareText(a: string, b: string) {
    return a.localeCompare(b, "zh-Hans-CN", {
        sensitivity: "base",
        numeric: true,
    });
}

function normalizeCacheQualityKey(key: string) {
    return legacyCacheQualityMap[key] ?? key;
}

export function normalizeMediaCacheItem(
    mediaItem: unknown,
): IMusic.IMusicItemCache | null {
    if (!mediaItem || typeof mediaItem !== "object" || Array.isArray(mediaItem)) {
        return null;
    }

    const item = mediaItem as IMusic.IMusicItemCache;
    if (!cleanText(item.platform) || !cleanText(item.id)) {
        return null;
    }

    return item;
}

function hasQualityPayload(value: unknown) {
    if (!value || typeof value !== "object") {
        return false;
    }

    const payload = value as Record<string, unknown>;
    return (
        payload.url !== undefined ||
        payload.size !== undefined ||
        payload.headers !== undefined ||
        payload.userAgent !== undefined ||
        payload.ekey !== undefined ||
        payload.cek !== undefined
    );
}

export function getMediaCacheEntryQualityKeys(
    mediaItem: Partial<IMusic.IMusicItemCache>,
) {
    const qualityKeys = new Set<string>();
    const collect = (record?: Record<string, unknown>) => {
        if (!record || typeof record !== "object") {
            return;
        }

        Object.entries(record).forEach(([key, value]) => {
            const normalizedKey = normalizeCacheQualityKey(key.trim());
            if (normalizedKey && hasQualityPayload(value)) {
                qualityKeys.add(normalizedKey);
            }
        });
    };

    collect(mediaItem.source as Record<string, unknown> | undefined);
    collect(mediaItem.qualities as Record<string, unknown> | undefined);

    if (!qualityKeys.size && cleanText(mediaItem.url)) {
        qualityKeys.add(DEFAULT_MEDIA_CACHE_QUALITY);
    }

    return Array.from(qualityKeys).sort(compareText);
}

export function createMediaCacheEntry(
    record: MediaCacheRawRecord,
): MediaCacheEntry | null {
    const mediaItem = normalizeMediaCacheItem(
        safeParse<IMusic.IMusicItemCache>(record.raw ?? ""),
    );
    if (!mediaItem) {
        return null;
    }

    const platform = cleanText(mediaItem.platform);
    const id = cleanText(mediaItem.id);
    if (!platform || !id) {
        return null;
    }

    return {
        key: record.key,
        platform,
        id,
        title: cleanText(mediaItem.title),
        artist: cleanText(mediaItem.artist),
        album: cleanText(mediaItem.album),
        qualityKeys: getMediaCacheEntryQualityKeys(mediaItem),
        approximateSize: record.raw?.length ?? 0,
        mediaItem,
    };
}

export function buildMediaCacheEntries(records: MediaCacheRawRecord[]) {
    return records
        .map(createMediaCacheEntry)
        .filter((entry): entry is MediaCacheEntry => !!entry)
        .sort((a, b) => {
            const byPlatform = compareText(a.platform, b.platform);
            if (byPlatform) return byPlatform;
            const byTitle = compareText(a.title, b.title);
            if (byTitle) return byTitle;
            const byArtist = compareText(a.artist, b.artist);
            if (byArtist) return byArtist;
            return compareText(a.id, b.id);
        });
}

export function getMediaCachePlatforms(entries: MediaCacheEntry[]) {
    return Array.from(new Set(entries.map(entry => entry.platform))).sort(
        compareText,
    );
}

export function getMediaCacheQualities(entries: MediaCacheEntry[]) {
    return Array.from(
        new Set(entries.flatMap(entry => entry.qualityKeys)),
    ).sort(compareText);
}

export function getUniqueMediaCacheKeys(keys: readonly string[]) {
    return Array.from(
        new Set(keys.map(key => key.trim()).filter(Boolean)),
    );
}

export function getMediaCacheEntryKeys(entries: readonly MediaCacheEntry[]) {
    return getUniqueMediaCacheKeys(entries.map(entry => entry.key));
}

export function filterMediaCacheEntries(
    entries: MediaCacheEntry[],
    filter: MediaCacheEntryFilter,
) {
    const platform = filter.platform?.trim();
    const quality = filter.quality?.trim();
    const query = filter.query?.trim().toLocaleLowerCase();

    return entries.filter(entry => {
        if (platform && entry.platform !== platform) {
            return false;
        }
        if (quality && !entry.qualityKeys.includes(quality)) {
            return false;
        }
        if (!query) {
            return true;
        }

        return [
            entry.title,
            entry.artist,
            entry.album,
            entry.platform,
            entry.id,
            entry.key,
        ].some(value => value.toLocaleLowerCase().includes(query));
    });
}
