import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import { useCallback, useEffect, useRef, useState } from "react";

export default function useAlbumDetail(
    originalAlbumItem: ICommon.WithMusicList<IAlbum.IAlbumItemBase> | null,
    pluginHash?: string,
) {
    const currentPageRef = useRef(1);
    const didRequestFirstPageRef = useRef(false);

    const [requestState, setRequestState] = useState<RequestStateCode>(RequestStateCode.IDLE);
    const [albumItem, setAlbumItem] = useState<IAlbum.IAlbumItemBase | null>(
        originalAlbumItem,
    );
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>(
        originalAlbumItem?.musicList ?? [],
    );

    const getAlbumDetail = useCallback(
        async function () {
            // 加载中：直接退出
            if (originalAlbumItem === null ||
                requestState === RequestStateCode.FINISHED ||
                requestState === RequestStateCode.PENDING_FIRST_PAGE ||
                requestState === RequestStateCode.PENDING_REST_PAGE) {
                return;
            }

            try {
                if (currentPageRef.current === 1) {
                    setRequestState(RequestStateCode.PENDING_FIRST_PAGE);
                } else {
                    setRequestState(RequestStateCode.PENDING_REST_PAGE);
                }
                const plugin =
                    (pluginHash
                        ? PluginManager.getByHash(pluginHash)
                        : undefined) ??
                    PluginManager.getByMedia(originalAlbumItem);
                if (!plugin) {
                    if (originalAlbumItem.musicList?.length) {
                        setRequestState(RequestStateCode.FINISHED);
                        return;
                    }
                    throw new Error();
                }
                const result = await plugin?.methods?.getAlbumInfo?.(
                    originalAlbumItem,
                    currentPageRef.current,
                );
                if (!result) {
                    throw new Error();
                }
                if (result?.albumItem) {
                    setAlbumItem(prev => ({
                        ...(prev ?? {}),
                        ...(result.albumItem as IAlbum.IAlbumItemBase),
                        platform: originalAlbumItem.platform,
                    }));
                }
                if (result?.musicList) {
                    setMusicList(prev => {
                        if (currentPageRef.current === 1) {
                            return result?.musicList ?? prev;
                        } else {
                            return [...prev, ...(result.musicList ?? [])];
                        }
                    });
                }
                if (result.isEnd) {
                    setRequestState(RequestStateCode.FINISHED);
                } else {
                    setRequestState(RequestStateCode.PARTLY_DONE);
                }
                currentPageRef.current += 1;
            } catch {
                setRequestState(RequestStateCode.ERROR);
            }
        },
        [originalAlbumItem, pluginHash, requestState],
    );

    useEffect(() => {
        if (didRequestFirstPageRef.current) {
            return;
        }
        didRequestFirstPageRef.current = true;
        getAlbumDetail();
    }, [getAlbumDetail]);

    return [requestState, albumItem, musicList, getAlbumDetail] as const;
}
