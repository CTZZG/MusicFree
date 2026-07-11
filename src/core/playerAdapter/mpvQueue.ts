import type { PlayerAdapterRepeatMode, PlayerBackendState } from "./types";

interface MpvQueueCursor {
    currentIndex: number;
    queueLength: number;
    repeatMode: PlayerAdapterRepeatMode;
}

interface MpvQueueSyncCursor {
    currentIndex: number;
    queueLength: number;
    activeIndex?: number | null;
}

interface MpvPlayDecisionCursor {
    hasLoaded: boolean;
    currentState: PlayerBackendState;
    currentIndex: number;
    queueLength: number;
    isAtTrackEnd: boolean;
}

export type MpvPlayAction =
    | "finish-ended"
    | "resume"
    | "reload-current"
    | "none";

export function isValidMpvQueueIndex(
    currentIndex: unknown,
    queueLength: number,
): currentIndex is number {
    return (
        queueLength > 0 &&
        typeof currentIndex === "number" &&
        Number.isInteger(currentIndex) &&
        currentIndex >= 0 &&
        currentIndex < queueLength
    );
}

export function resolveMpvCurrentIndexAfterQueueSync(
    cursor: MpvQueueSyncCursor,
) {
    const { activeIndex, currentIndex, queueLength } = cursor;
    if (activeIndex !== undefined) {
        return isValidMpvQueueIndex(activeIndex, queueLength)
            ? activeIndex
            : -1;
    }
    return isValidMpvQueueIndex(currentIndex, queueLength) ? currentIndex : -1;
}

export function resolveMpvLoadQueueStartIndex(
    queueLength: number,
    startIndex: number,
) {
    if (queueLength <= 0) {
        return null;
    }
    return isValidMpvQueueIndex(startIndex, queueLength) ? startIndex : null;
}

export function resolveMpvPlayAction(cursor: MpvPlayDecisionCursor): MpvPlayAction {
    const { hasLoaded, currentState, currentIndex, queueLength, isAtTrackEnd } =
        cursor;
    const hasValidCurrent = isValidMpvQueueIndex(currentIndex, queueLength);
    if (!hasValidCurrent) {
        return "none";
    }

    if (!hasLoaded) {
        return "reload-current";
    }

    if (currentState !== "ended" && isAtTrackEnd) {
        return "finish-ended";
    }

    if (
        currentState === "idle" ||
        currentState === "stopped" ||
        currentState === "error"
    ) {
        return "reload-current";
    }

    return "resume";
}

export function computeMpvNextIndex(
    cursor: MpvQueueCursor,
    wrapForManual: boolean,
) {
    const { currentIndex, queueLength, repeatMode } = cursor;
    if (!isValidMpvQueueIndex(currentIndex, queueLength)) {
        return null;
    }

    const next = currentIndex + 1;
    if (next < queueLength) {
        return next;
    }
    if (repeatMode === "queue" || wrapForManual) {
        return 0;
    }
    return null;
}

export function computeMpvPreviousIndex(cursor: MpvQueueCursor) {
    const { currentIndex, queueLength } = cursor;
    if (!isValidMpvQueueIndex(currentIndex, queueLength)) {
        return null;
    }

    return currentIndex - 1 < 0 ? queueLength - 1 : currentIndex - 1;
}

export function collectMpvNextIndices(cursor: MpvQueueCursor, count: number) {
    const { currentIndex, queueLength, repeatMode } = cursor;
    const targetCount = Math.max(0, count);
    if (
        !isValidMpvQueueIndex(currentIndex, queueLength) ||
        targetCount === 0
    ) {
        return [];
    }

    const result: number[] = [];
    for (let offset = 1; result.length < targetCount; offset += 1) {
        const index = currentIndex + offset;
        if (index < queueLength) {
            result.push(index);
            continue;
        }
        if (repeatMode !== "queue") {
            break;
        }
        const wrapped = index % queueLength;
        if (wrapped === currentIndex) {
            break;
        }
        result.push(wrapped);
    }
    return result;
}
