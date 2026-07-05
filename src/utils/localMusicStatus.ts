export function findLocalMusicItem<T extends ICommon.IMediaBase>(
    localMusicList: readonly T[],
    musicItem: ICommon.IMediaBase | null | undefined,
) {
    if (!musicItem) {
        return undefined;
    }

    return localMusicList.find(
        item =>
            item.platform === musicItem.platform &&
            // eslint-disable-next-line eqeqeq
            item.id == musicItem.id,
    );
}

export function resolveLocalFileCheckItem<T extends ICommon.IMediaBase>(
    localMusicList: readonly T[],
    musicItem: T | null | undefined,
) {
    if (!musicItem) {
        return null;
    }

    return findLocalMusicItem(localMusicList, musicItem) ?? musicItem;
}
