import type {
    PlayerAdapterTrackSourceMeta,
    PlayerAdapterTrackSourceOrigin,
} from "./types";

const playbackSourceOrigins: ReadonlySet<PlayerAdapterTrackSourceOrigin> =
    new Set([
        "plugin",
        "direct",
        "embedded-cache",
        "similar-plugin",
        "recovery",
    ]);

export function stringifyPlaybackSourceMeta(
    sourceMeta?: PlayerAdapterTrackSourceMeta,
) {
    if (!sourceMeta || typeof sourceMeta !== "object") {
        return undefined;
    }

    try {
        return JSON.stringify(sourceMeta);
    } catch {
        return undefined;
    }
}

export function parsePlaybackSourceMeta(value?: unknown) {
    if (typeof value !== "string") {
        return undefined;
    }

    try {
        return sanitizePlaybackSourceMeta(JSON.parse(value));
    } catch {
        return undefined;
    }
}

export function sanitizePlaybackSourceMeta(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    const payload = value as Record<string, unknown>;
    const meta: PlayerAdapterTrackSourceMeta = {};

    if (typeof payload.quality === "string") {
        meta.quality = payload.quality as IMusic.IQualityKey;
    }
    if (
        typeof payload.origin === "string" &&
        playbackSourceOrigins.has(payload.origin as PlayerAdapterTrackSourceOrigin)
    ) {
        meta.origin = payload.origin as PlayerAdapterTrackSourceOrigin;
    }
    if (typeof payload.cacheKey === "string") {
        meta.cacheKey = payload.cacheKey;
    }
    if (typeof payload.recovered === "boolean") {
        meta.recovered = payload.recovered;
    }
    if (
        typeof payload.resolvedAt === "number" &&
        Number.isFinite(payload.resolvedAt)
    ) {
        meta.resolvedAt = payload.resolvedAt;
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
}
