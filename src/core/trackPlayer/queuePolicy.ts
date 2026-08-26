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
        return null;
    }

    if (playLaterQueueLength > 0) {
        return null;
    }

    if (currentIndex < 0) {
        return null;
    }
    // 预载的职责是「预测自然结束时实际会播哪一首」，所以必须复用同一份推进逻辑。
    // 以前这里是另写的一段、且在队尾直接返回 null，于是列表循环每绕一圈，在
    // 末曲→首曲那个边界上原生 runway 必定为空，只能等 JS 实时响应；App 在后台
    // 时这一步不一定跑得动，播放就停在曲尾。
    // 三种模式（QUEUE / SHUFFLE / SINGLE）在队尾都会回绕（SHUFFLE 是预先打乱
    // playList，推进方式与 QUEUE 相同），不存在「到队尾就该停」的模式；SINGLE
    // 已在上面单独返回 null——它必须由 JS 重新加载，不能让 mpv 无缝重复同一首。
    return findNextPlayableQueueItem(queue, currentIndex, currentItem, {
        isSameItem,
        isSkipped,
    });
}

/**
 * resolvePreparedNextItem 的多首版本：预测「如果从这里连续自然结束 count
 * 次，会依次播放哪些曲目」，用于给 mpv 一次性批量预备多首、原生自动接续。
 * 每一步都用上一步选中的曲目/下标作为新的“当前项”继续向后找——这与真实
 * 播放推进完全一致，因此同一首歌在队列里出现多次时，后面还能再次被选中
 * （不是一次性排除整份队列里同名的曲目，那样会把正常的循环/重复队列
 * 也当成断档处理）。
 */
export function resolvePreparedNextItems<T>(
    options: ResolvePreparedNextItemOptions<T> & { count: number },
): T[] {
    const {
        currentItem,
        queue,
        currentIndex,
        repeatMode,
        playLaterQueueLength,
        isSameItem,
        isSkipped,
        count,
    } = options;

    if (!currentItem || queue.length === 0 || count <= 0) {
        return [];
    }
    if (repeatMode === MusicRepeatMode.SINGLE) {
        return [];
    }
    if (playLaterQueueLength > 0) {
        return [];
    }
    if (currentIndex < 0) {
        return [];
    }

    const results: T[] = [];
    let anchorIndex = currentIndex;
    let anchorItem: T = currentItem;
    for (let picked = 0; picked < count; picked += 1) {
        let foundIndex = -1;
        let foundItem: T | null = null;
        for (let offset = 1; offset <= queue.length; offset += 1) {
            const index =
                ((anchorIndex + offset) % queue.length + queue.length) %
                queue.length;
            const candidate = queue[index];
            if (
                candidate !== undefined &&
                !isSameItem(candidate, anchorItem) &&
                !isSkipped(candidate)
            ) {
                foundIndex = index;
                foundItem = candidate;
                break;
            }
        }
        if (foundItem === null) {
            break;
        }
        results.push(foundItem);
        anchorIndex = foundIndex;
        anchorItem = foundItem;
    }
    return results;
}

export function getSafeUnresolvedQueueUrl(url?: string | null) {
    if (typeof url !== "string") {
        return "";
    }
    const candidate = url.trim();
    return /^(?:file|content):\/\//i.test(candidate) ? candidate : "";
}
