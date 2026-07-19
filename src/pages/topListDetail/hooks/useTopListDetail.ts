import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import { useCallback, useEffect, useRef, useState } from "react";

export default function useTopListDetail(
    topListItem: IMusic.IMusicSheetItemBase | null,
    pluginHash: string,
) {
    const [mergedTopListItem, setMergedTopListItem] =
        useState<ICommon.WithMusicList<IMusic.IMusicSheetItemBase> | null>(
            topListItem,
        );

    const pageRef = useRef(1);
    const loadingRef = useRef(false);
    const finishedRef = useRef(false);
    const requestGenerationRef = useRef(0);

    const [requestState, setRequestState] = useState(RequestStateCode.IDLE);

    const loadMore = useCallback(async () => {
        if (!topListItem || loadingRef.current || finishedRef.current) {
            return;
        }
        const requestGeneration = requestGenerationRef.current;
        const requestedPage = pageRef.current;
        loadingRef.current = true;
        try {
            if (requestedPage === 1) {
                setRequestState(RequestStateCode.PENDING_FIRST_PAGE);
            } else {
                setRequestState(RequestStateCode.PENDING_REST_PAGE);
            }
            const result = await PluginManager.getByHash(
                pluginHash,
            )?.methods?.getTopListDetail(topListItem, requestedPage);
            if (requestGenerationRef.current !== requestGeneration) {
                return;
            }
            if (!result) {
                throw new Error();
            }
            setMergedTopListItem(
                prev =>
                    ({
                        ...prev,
                        ...result.topListItem,
                        musicList:
                            requestedPage === 1
                                ? result.musicList ?? []
                                : [
                                    ...(prev?.musicList ?? []),
                                    ...(result.musicList ?? []),
                                ],
                    } as IMusic.IMusicSheetItem),
            );

            finishedRef.current = result.isEnd !== false;
            if (!finishedRef.current) {
                setRequestState(RequestStateCode.PARTLY_DONE);
            } else {
                setRequestState(RequestStateCode.FINISHED);
            }
            pageRef.current = requestedPage + 1;
        } catch {
            if (requestGenerationRef.current === requestGeneration) {
                setRequestState(RequestStateCode.ERROR);
            }
        } finally {
            if (requestGenerationRef.current === requestGeneration) {
                loadingRef.current = false;
            }
        }
    }, [pluginHash, topListItem]);

    useEffect(() => {
        const generation = ++requestGenerationRef.current;
        pageRef.current = 1;
        loadingRef.current = false;
        finishedRef.current = false;
        setMergedTopListItem(topListItem);
        setRequestState(RequestStateCode.IDLE);

        if (topListItem !== null) {
            loadMore();
        }

        return () => {
            if (requestGenerationRef.current === generation) {
                requestGenerationRef.current += 1;
                loadingRef.current = false;
            }
        };
    }, [loadMore, pluginHash, topListItem]);
    return [mergedTopListItem, requestState, loadMore] as const;
}
