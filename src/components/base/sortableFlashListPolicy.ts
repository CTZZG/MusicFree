export const sortableAutoScrollThresholdRatio = 0.2;
export const sortableAutoScrollSpeedPerMs = 25 / 22;
export const sortableAutoScrollMaxFrameMs = 48;
export const sortableSlowFrameBudgetMs = 34;

export type SortableAccessibilityAction =
    | "increment"
    | "decrement"
    | "moveToTop"
    | "moveToBottom";

export function getSortableAccessibilityTarget(
    length: number,
    index: number,
    action: string,
) {
    if (!isSortableIndex(length, index)) {
        return null;
    }
    const target = action === "decrement"
        ? index - 1
        : action === "increment"
            ? index + 1
            : action === "moveToTop"
                ? 0
                : action === "moveToBottom"
                    ? length - 1
                    : index;
    return isSortableIndex(length, target) && target !== index
        ? target
        : null;
}

export interface ISortableFrameStats {
    frameCount: number;
    slowFrameCount: number;
    maxFrameMs: number;
}

export function updateSortableFrameStats(
    stats: ISortableFrameStats,
    elapsedMs: number,
) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return stats;
    }
    return {
        frameCount: stats.frameCount + 1,
        slowFrameCount:
            stats.slowFrameCount +
            (elapsedMs > sortableSlowFrameBudgetMs ? 1 : 0),
        maxFrameMs: Math.max(stats.maxFrameMs, elapsedMs),
    };
}

export function isSortableIndex(length: number, index: number) {
    return (
        Number.isInteger(length) &&
        length > 0 &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < length
    );
}

export function moveSortableItem<T>(
    data: readonly T[],
    fromIndex: number,
    toIndex: number,
): T[] | null {
    if (
        !isSortableIndex(data.length, fromIndex) ||
        !isSortableIndex(data.length, toIndex) ||
        fromIndex === toIndex
    ) {
        return null;
    }

    const next = data.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}

export function getSortableDropIndex(params: {
    dataLength: number;
    itemHeight: number;
    scrollOffset: number;
    draggingItemOffsetY: number;
}) {
    const {
        dataLength,
        itemHeight,
        scrollOffset,
        draggingItemOffsetY,
    } = params;
    if (
        !Number.isInteger(dataLength) ||
        dataLength <= 0 ||
        !Number.isFinite(itemHeight) ||
        itemHeight <= 0 ||
        !Number.isFinite(scrollOffset) ||
        !Number.isFinite(draggingItemOffsetY)
    ) {
        return null;
    }

    const unboundedIndex = Math.floor(
        (scrollOffset + draggingItemOffsetY + itemHeight / 2) / itemHeight,
    );
    return Math.min(Math.max(unboundedIndex, 0), dataLength - 1);
}

export function getSortableAutoScrollOffset(params: {
    draggingItemOffsetY: number;
    itemHeight: number;
    viewportHeight: number;
    contentHeight: number;
    currentOffset: number;
    elapsedMs: number;
}) {
    const {
        draggingItemOffsetY,
        itemHeight,
        viewportHeight,
        contentHeight,
        currentOffset,
        elapsedMs,
    } = params;
    if (
        !Number.isFinite(draggingItemOffsetY) ||
        draggingItemOffsetY < 0 ||
        !Number.isFinite(itemHeight) ||
        itemHeight <= 0 ||
        !Number.isFinite(viewportHeight) ||
        viewportHeight <= 0 ||
        !Number.isFinite(contentHeight) ||
        !Number.isFinite(currentOffset) ||
        !Number.isFinite(elapsedMs)
    ) {
        return Number.isFinite(currentOffset) ? currentOffset : 0;
    }

    const maxOffset = Math.max(contentHeight - viewportHeight, 0);
    const safeCurrentOffset = Math.min(Math.max(currentOffset, 0), maxOffset);
    if (!maxOffset) {
        return safeCurrentOffset;
    }

    const threshold = Math.max(
        viewportHeight * sortableAutoScrollThresholdRatio,
        1,
    );
    const itemBottom = draggingItemOffsetY + itemHeight;
    let direction = 0;
    let speedFactor = 0;

    if (draggingItemOffsetY < threshold) {
        direction = -1;
        speedFactor = (threshold - draggingItemOffsetY) / threshold;
    } else if (itemBottom > viewportHeight - threshold) {
        direction = 1;
        speedFactor = (itemBottom - (viewportHeight - threshold)) / threshold;
    }

    if (!direction) {
        return safeCurrentOffset;
    }

    const frameMs = Math.min(
        Math.max(elapsedMs, 0),
        sortableAutoScrollMaxFrameMs,
    );
    const delta =
        direction *
        sortableAutoScrollSpeedPerMs *
        frameMs *
        Math.min(Math.max(speedFactor, 0), 1);
    return Math.min(Math.max(safeCurrentOffset + delta, 0), maxOffset);
}
