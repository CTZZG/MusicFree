/** Reorder by identity; retain the original array for missing targets and no-ops. */
export function moveQueueItem<T>(
    queue: readonly T[],
    item: T,
    destination: number,
    same: (left: T, right: T) => boolean,
): readonly T[] {
    const index = queue.findIndex(entry => same(entry, item));
    if (index < 0 || !Number.isFinite(destination)) {
        return queue;
    }
    const target = Math.max(0, Math.min(queue.length - 1, Math.trunc(destination)));
    if (target === index) {
        return queue;
    }
    const result = [...queue];
    const [moved] = result.splice(index, 1);
    result.splice(target, 0, moved);
    return result;
}

export function moveQueueItemAfterCurrent<T>(
    queue: readonly T[],
    item: T,
    current: T | null,
    same: (left: T, right: T) => boolean,
): readonly T[] {
    const index = queue.findIndex(entry => same(entry, item));
    const currentIndex = current ? queue.findIndex(entry => same(entry, current)) : -1;
    if (index < 0 || (current && same(item, current))) {
        return queue;
    }
    // Removing an earlier entry also moves the current song one position left.
    const target = currentIndex < 0 ? 0 : currentIndex + (index > currentIndex ? 1 : 0);
    return moveQueueItem(queue, item, target, same);
}

export function hasSameQueueOrder<T>(
    left: readonly T[],
    right: readonly T[],
    same: (left: T, right: T) => boolean,
) {
    return left.length === right.length && left.every((item, index) => same(item, right[index]));
}

/** Keep source/metadata hydration that happened after an undo snapshot was captured. */
export function restoreQueueSnapshot<T>(snapshot: readonly T[], latest: readonly T[], keyOf: (item: T) => string): T[] {
    const byKey = new Map(latest.map(item => [keyOf(item), item]));
    return snapshot.map(item => byKey.get(keyOf(item)) ?? item);
}
