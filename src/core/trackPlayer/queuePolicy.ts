import { MusicRepeatMode } from "@/constants/trackPlayerConst";

export interface QueuePolicyIdentity<T> {
    isSameItem(a?: T | null, b?: T | null): boolean;
    isSkipped(item: T): boolean;
}

export function getWrappedQueueItem<T>(
    queue: readonly T[],
    index: number,
): T | null {
    const len = queue.length;
    if (len === 0) {
        return null;
    }
    return queue[((index % len) + len) % len] ?? null;
}

export function findNextPlayableQueueItem<T>(
    queue: readonly T[],
    currentIndex: number,
    currentItem: T,
    identity: QueuePolicyIdentity<T>,
): T | null {
    for (let offset = 1; offset <= queue.length; offset += 1) {
        const candidate = getWrappedQueueItem(queue, currentIndex + offset);
        if (
            candidate &&
            !identity.isSameItem(candidate, currentItem) &&
            !identity.isSkipped(candidate)
        ) {
            return candidate;
        }
    }

    return null;
}

export interface QueueItemAtIndex<T> {
    index: number;
    item: T;
}

export function resolvePreviousQueueItem<T>(
    queue: readonly T[],
    currentIndex: number,
): QueueItemAtIndex<T> | null {
    const len = queue.length;
    if (len === 0 || currentIndex < 0) {
        return null;
    }

    const index = ((currentIndex - 1) % len + len) % len;
    const item = queue[index];
    return item === undefined
        ? null
        : {
            index,
            item,
        };
}

export interface ReplaceQueueItemResult<T> {
    queue: T[];
    index: number;
    replaced: boolean;
}

export function replaceQueueItemByIdentity<T>(
    queue: readonly T[],
    item: T,
    isSameItem: (a?: T | null, b?: T | null) => boolean,
): ReplaceQueueItemResult<T> {
    const index = queue.findIndex(candidate => isSameItem(candidate, item));
    if (index < 0) {
        return {
            queue: [...queue],
            index: -1,
            replaced: false,
        };
    }

    if (queue[index] === item) {
        return {
            queue: [...queue],
            index,
            replaced: false,
        };
    }

    const nextQueue = [...queue];
    nextQueue[index] = item;
    return {
        queue: nextQueue,
        index,
        replaced: true,
    };
}

export interface ResolvePreparedNextItemOptions<T>
    extends QueuePolicyIdentity<T> {
    currentItem?: T | null;
    queue: readonly T[];
    currentIndex: number;
    repeatMode: MusicRepeatMode;
    playLaterQueueLength: number;
}

export function resolvePreparedNextItem<T>(
    options: ResolvePreparedNextItemOptions<T>,
): T | null {
    const {
        currentItem,
        queue,
        currentIndex,
        repeatMode,
        playLaterQueueLength,
        isSameItem,
        isSkipped,
    } = options;

    if (!currentItem || queue.length === 0) {
        return null;
    }

    if (repeatMode === MusicRepeatMode.SINGLE) {
        return currentItem;
    }

    if (playLaterQueueLength > 0) {
        return null;
    }

    return findNextPlayableQueueItem(queue, currentIndex, currentItem, {
        isSameItem,
        isSkipped,
    });
}
