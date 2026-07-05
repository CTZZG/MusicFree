import type { IParsedLrcItem } from "@/utils/lrcParser";

interface ILyricPayloadMusicIdentity {
    id?: string | number | null;
    platform?: string | null;
}

function normalizeIndex(index?: number | null) {
    if (typeof index !== "number" || !Number.isFinite(index)) {
        return -1;
    }
    return Math.trunc(index);
}

export function resolveLyricRestoreIndex(params: {
    lyricsLength: number;
    activeIndex?: number | null;
    restoreIndex?: number | null;
}) {
    const { lyricsLength, restoreIndex, activeIndex } = params;
    if (lyricsLength <= 0) {
        return -1;
    }

    const preferredIndex = normalizeIndex(restoreIndex);
    const fallbackIndex = normalizeIndex(activeIndex);
    const resolvedIndex = preferredIndex !== -1 ? preferredIndex : fallbackIndex;
    const safeIndex = resolvedIndex === -1 ? 0 : resolvedIndex;

    return Math.max(0, Math.min(safeIndex, lyricsLength - 1));
}

export function getLyricScrollTargetIndex(
    lyrics: readonly Pick<IParsedLrcItem, "time">[],
    positionMs: number,
    offsetSeconds: number,
    leadMs = 0,
) {
    if (!lyrics.length) {
        return -1;
    }

    const safePositionMs = Number.isFinite(positionMs) ? positionMs : 0;
    const safeOffsetSeconds = Number.isFinite(offsetSeconds)
        ? offsetSeconds
        : 0;
    const safeLeadMs = Number.isFinite(leadMs) ? leadMs : 0;
    const targetSeconds =
        safePositionMs / 1000 + safeLeadMs / 1000 - safeOffsetSeconds;

    if (targetSeconds < lyrics[0].time) {
        return 0;
    }

    let left = 0;
    let right = lyrics.length - 1;
    while (left < right) {
        const middle = (left + right + 1) >>> 1;
        if (lyrics[middle].time <= targetSeconds) {
            left = middle;
        } else {
            right = middle - 1;
        }
    }

    return left;
}

export function createLyricPayloadIdentity(
    music: ILyricPayloadMusicIdentity | null | undefined,
    lyrics: readonly Pick<IParsedLrcItem, "time">[],
) {
    return [
        music?.platform ?? "",
        music?.id ?? "",
        lyrics.length,
        lyrics[0]?.time ?? "",
        lyrics[lyrics.length - 1]?.time ?? "",
    ].join(":");
}
