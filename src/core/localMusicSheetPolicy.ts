export function mergeEditedListWithConcurrentChanges<T>(params: {
    current: readonly T[];
    edited: readonly T[];
    baseline: readonly T[];
    getKey(item: T): string;
}) {
    const { current, edited, baseline, getKey } = params;
    const baselineKeys = new Set(baseline.map(getKey));
    const currentByKey = new Map(current.map(item => [getKey(item), item]));
    const seenKeys = new Set<string>();
    const merged: T[] = [];

    edited.forEach(editedItem => {
        const key = getKey(editedItem);
        if (seenKeys.has(key)) {
            return;
        }
        if (currentByKey.has(key)) {
            merged.push(currentByKey.get(key)!);
            seenKeys.add(key);
            return;
        }
        // Items introduced by the editor itself are kept. A baseline item that
        // disappeared from current was removed concurrently and must not be
        // resurrected from the stale editor snapshot.
        if (!baselineKeys.has(key)) {
            merged.push(editedItem);
            seenKeys.add(key);
        }
    });

    current.forEach(currentItem => {
        const key = getKey(currentItem);
        if (!seenKeys.has(key) && !baselineKeys.has(key)) {
            merged.push(currentItem);
            seenKeys.add(key);
        }
    });

    return merged;
}
