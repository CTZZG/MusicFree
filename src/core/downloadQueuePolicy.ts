import { findLocalMusicItem } from "@/utils/localMusicStatus";

export interface DownloadQueuePolicyOptions {
    activeTaskKeys: ReadonlySet<string>;
    localMusicItems: readonly ICommon.IMediaBase[];
    getKey(musicItem: ICommon.IMediaBase): string;
}

export function shouldQueueDownloadTask<T extends ICommon.IMediaBase>(
    musicItem: T | null | undefined,
    options: DownloadQueuePolicyOptions,
) {
    if (!musicItem) {
        return false;
    }

    if (options.activeTaskKeys.has(options.getKey(musicItem))) {
        return false;
    }

    return !findLocalMusicItem(options.localMusicItems, musicItem);
}

export function filterQueueableDownloadItems<T extends ICommon.IMediaBase>(
    musicItems: readonly T[],
    options: DownloadQueuePolicyOptions,
) {
    const acceptedTaskKeys = new Set(options.activeTaskKeys);
    const acceptedItems: T[] = [];

    for (const musicItem of musicItems) {
        if (
            !shouldQueueDownloadTask(musicItem, {
                ...options,
                activeTaskKeys: acceptedTaskKeys,
            })
        ) {
            continue;
        }

        acceptedItems.push(musicItem);
        acceptedTaskKeys.add(options.getKey(musicItem));
    }

    return acceptedItems;
}
