import type { IBasicMeta } from "@/native/mp3Util";
import type { ILocalMusicScanCandidate } from "./localMusicScanTypes";

export const localMusicMetadataCacheVersion = 1;
export const localMusicMetadataCacheMaxEntries = 12000;
export const localMusicMetadataCacheMaxAgeMs = 90 * 24 * 60 * 60 * 1000;

export interface ILocalMusicMetadataCacheEntry {
    fingerprint: string;
    metadata: IBasicMeta;
    updatedAt: number;
}

export interface ILocalMusicMetadataCache {
    version: typeof localMusicMetadataCacheVersion;
    entries: Record<string, ILocalMusicMetadataCacheEntry>;
}

export function createEmptyLocalMusicMetadataCache(): ILocalMusicMetadataCache {
    return {
        version: localMusicMetadataCacheVersion,
        entries: {},
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKnownNumber(value: unknown) {
    if (
        value === null ||
        value === undefined ||
        typeof value === "boolean" ||
        (typeof value === "string" && !value.trim())
    ) {
        return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
        ? numberValue
        : null;
}

function normalizeMetadata(value: unknown): IBasicMeta | null {
    if (!isRecord(value)) {
        return null;
    }
    const metadata: IBasicMeta = {};
    (["album", "artist", "author", "duration", "title"] as const)
        .forEach(key => {
            const item = value[key];
            if (
                (typeof item === "string" && item.trim()) ||
                (typeof item === "number" && Number.isFinite(item))
            ) {
                metadata[key] = String(item);
            }
        });
    return Object.keys(metadata).length ? metadata : null;
}

export function isUsableLocalMusicMetadata(value: unknown) {
    return normalizeMetadata(value) !== null;
}

export function createLocalMusicMetadataFingerprint(
    candidate: ILocalMusicScanCandidate,
) {
    const size = normalizeKnownNumber(candidate.size);
    const modifiedAt = normalizeKnownNumber(candidate.modifiedAt);
    if (size === null || modifiedAt === null || modifiedAt === 0) {
        return null;
    }
    return `${Math.trunc(size)}:${Math.trunc(modifiedAt)}`;
}

export function normalizeLocalMusicMetadataCache(
    value: unknown,
    now = Date.now(),
): ILocalMusicMetadataCache {
    const result = createEmptyLocalMusicMetadataCache();
    if (
        !isRecord(value) ||
        value.version !== localMusicMetadataCacheVersion ||
        !isRecord(value.entries)
    ) {
        return result;
    }

    Object.entries(value.entries).forEach(([musicPath, rawEntry]) => {
        if (!musicPath || !isRecord(rawEntry)) {
            return;
        }
        const fingerprint = rawEntry.fingerprint;
        const updatedAt = normalizeKnownNumber(rawEntry.updatedAt);
        const metadata = normalizeMetadata(rawEntry.metadata);
        if (
            typeof fingerprint !== "string" ||
            !fingerprint ||
            updatedAt === null ||
            updatedAt > now ||
            now - updatedAt > localMusicMetadataCacheMaxAgeMs ||
            !metadata
        ) {
            return;
        }
        result.entries[musicPath] = {
            fingerprint,
            metadata,
            updatedAt,
        };
    });

    return pruneLocalMusicMetadataCache(result, now);
}

export function getLocalMusicCachedMetadata(
    cache: ILocalMusicMetadataCache,
    candidate: ILocalMusicScanCandidate,
    now = Date.now(),
) {
    const fingerprint = createLocalMusicMetadataFingerprint(candidate);
    const entry = cache.entries[candidate.musicPath];
    return fingerprint &&
        entry?.fingerprint === fingerprint &&
        entry.updatedAt <= now &&
        now - entry.updatedAt <= localMusicMetadataCacheMaxAgeMs
        ? entry.metadata
        : null;
}

export function setLocalMusicCachedMetadata(
    cache: ILocalMusicMetadataCache,
    candidate: ILocalMusicScanCandidate,
    metadata: IBasicMeta,
    now = Date.now(),
) {
    const fingerprint = createLocalMusicMetadataFingerprint(candidate);
    const normalizedMetadata = normalizeMetadata(metadata);
    if (!fingerprint || !normalizedMetadata) {
        return false;
    }
    cache.entries[candidate.musicPath] = {
        fingerprint,
        metadata: normalizedMetadata,
        updatedAt: now,
    };
    return true;
}

export function pruneLocalMusicMetadataCache(
    cache: ILocalMusicMetadataCache,
    now = Date.now(),
) {
    const entries = Object.entries(cache.entries)
        .filter(([, entry]) =>
            entry.updatedAt <= now &&
            now - entry.updatedAt <= localMusicMetadataCacheMaxAgeMs,
        )
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, localMusicMetadataCacheMaxEntries);
    cache.entries = Object.fromEntries(entries);
    return cache;
}
