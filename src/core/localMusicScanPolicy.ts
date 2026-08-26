export interface ILocalMusicScanPolicy {
    minDurationSeconds: number;
    minFileSizeBytes: number;
    filterLikelySystemSounds: boolean;
}

import type { ILocalMusicScanCandidate } from "./localMusicScanTypes";

export type { ILocalMusicScanCandidate } from "./localMusicScanTypes";

export interface ILocalMusicScanMetadata {
    duration?: string | number | null;
}

export type LocalMusicScanFilterReason =
    | "file-size"
    | "duration"
    | "likely-system-sound";

export const localMusicMinDurationOptions = [0, 8, 20, 60] as const;
export const localMusicMinFileSizeOptions = [
    0,
    256 * 1024,
    1024 * 1024,
    5 * 1024 * 1024,
] as const;

export const defaultLocalMusicScanPolicy: ILocalMusicScanPolicy = {
    // Preserve the legacy behavior: files shorter than eight seconds are
    // excluded, while likely system sounds are only excluded below 20 seconds.
    minDurationSeconds: 8,
    minFileSizeBytes: 0,
    filterLikelySystemSounds: true,
};

const likelySystemSoundDurationSeconds = 20;
const likelySystemSoundNamePattern =
    /(^|[-_\s])(alarm|alert|beep|ding|message|notification|ringtone|sms|sound|tone|提示|提示音|通知|铃声|鈴聲)([-_\s]|$)/i;

function getRecordValue(value: unknown, key: string) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    return (value as Record<string, unknown>)[key];
}

function normalizePolicyOption(
    value: unknown,
    fallback: number,
    options: readonly number[],
) {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !options.includes(value)
    ) {
        return fallback;
    }
    return value;
}

export function normalizeLocalMusicScanPolicy(
    value: unknown,
): ILocalMusicScanPolicy {
    const filterLikelySystemSounds = getRecordValue(
        value,
        "filterLikelySystemSounds",
    );
    return {
        minDurationSeconds: normalizePolicyOption(
            getRecordValue(value, "minDurationSeconds"),
            defaultLocalMusicScanPolicy.minDurationSeconds,
            localMusicMinDurationOptions,
        ),
        minFileSizeBytes: normalizePolicyOption(
            getRecordValue(value, "minFileSizeBytes"),
            defaultLocalMusicScanPolicy.minFileSizeBytes,
            localMusicMinFileSizeOptions,
        ),
        filterLikelySystemSounds:
            typeof filterLikelySystemSounds === "boolean"
                ? filterLikelySystemSounds
                : defaultLocalMusicScanPolicy.filterLikelySystemSounds,
    };
}

function getDisplayName(candidate: ILocalMusicScanCandidate) {
    const displayName = candidate.displayName?.trim();
    const fileName = displayName ||
        candidate.musicPath.split(/[\\/]/).pop() ||
        candidate.musicPath;
    const lastDotIndex = fileName.lastIndexOf(".");
    return lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
}

function getKnownSize(candidate: ILocalMusicScanCandidate) {
    if (candidate.size == null) {
        return null;
    }
    const size = Number(candidate.size);
    return Number.isFinite(size) && size >= 0 ? size : null;
}

function getKnownDurationSeconds(metadata?: ILocalMusicScanMetadata | null) {
    const durationMilliseconds = Number(metadata?.duration);
    if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0) {
        return null;
    }
    return durationMilliseconds / 1000;
}

export function isLikelySystemSoundName(value: string) {
    return likelySystemSoundNamePattern.test(value.trim().toLowerCase());
}

/**
 * Returns a reason only when the available facts make the decision safe.
 * Unknown file size and duration remain eligible for import.
 */
export function getLocalMusicScanFilterReason(
    candidate: ILocalMusicScanCandidate,
    metadata: ILocalMusicScanMetadata | null | undefined,
    policyValue: ILocalMusicScanPolicy | undefined,
): LocalMusicScanFilterReason | null {
    const policy = policyValue ?? defaultLocalMusicScanPolicy;
    const size = getKnownSize(candidate);
    if (
        policy.minFileSizeBytes > 0 &&
        size !== null &&
        size < policy.minFileSizeBytes
    ) {
        return "file-size";
    }

    const durationSeconds = getKnownDurationSeconds(metadata);
    if (durationSeconds === null) {
        return null;
    }
    if (
        policy.minDurationSeconds > 0 &&
        durationSeconds < policy.minDurationSeconds
    ) {
        return "duration";
    }
    if (
        policy.filterLikelySystemSounds &&
        durationSeconds < likelySystemSoundDurationSeconds &&
        isLikelySystemSoundName(getDisplayName(candidate))
    ) {
        return "likely-system-sound";
    }

    return null;
}
