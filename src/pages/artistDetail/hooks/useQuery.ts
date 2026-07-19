import { errorLog } from "@/utils/log";
import { RequestStateCode } from "@/constants/commonConst";
import { produce } from "immer";
import { getDefaultStore, useAtom } from "jotai";
import { useCallback, useRef } from "react";
import { queryResultAtom } from "../store/atoms";
import PluginManager from "@/core/pluginManager";

export default function useQueryArtist(pluginHash: string) {
    const [, setQueryResults] = useAtom(queryResultAtom);
    const requestGenerationRef = useRef(0);
    const contextRef = useRef<string | null>(null);

    const queryArtist = useCallback(
        async (
            artist: IArtist.IArtistItemBase,
            page?: number,
            type: IArtist.ArtistMediaType = "music",
        ) => {
            const plugin = PluginManager.getByHash(pluginHash);
            const contextKey = `${pluginHash}:${type}:${artist?.platform ?? ""}:${artist?.id ?? ""}`;
            const contextChanged = contextRef.current !== contextKey;
            if (contextChanged) {
                contextRef.current = contextKey;
                requestGenerationRef.current += 1;
                setQueryResults(
                    produce(draft => {
                        draft[type] = {};
                    }),
                );
            }

            const prevResult = contextChanged
                ? undefined
                : getDefaultStore().get(queryResultAtom)[type];
            if (
                prevResult?.state === RequestStateCode.PENDING_FIRST_PAGE ||
                prevResult?.state === RequestStateCode.PENDING_REST_PAGE ||
                prevResult?.state === RequestStateCode.FINISHED
            ) {
                return;
            }
            const requestedPage = page ?? ((prevResult?.page ?? 0) + 1);
            const requestGeneration = ++requestGenerationRef.current;
            try {
                setQueryResults(
                    produce(draft => {
                        draft[type].state = requestedPage === 1
                            ? RequestStateCode.PENDING_FIRST_PAGE
                            : RequestStateCode.PENDING_REST_PAGE;
                    }),
                );
                const result = await plugin?.methods?.getArtistWorks?.(
                    artist,
                    requestedPage,
                    type,
                );
                if (requestGenerationRef.current !== requestGeneration) {
                    return;
                }
                setQueryResults(
                    produce(draft => {
                        draft[type].page = requestedPage;
                        draft[type].state =
                            result?.isEnd === false
                                ? RequestStateCode.PARTLY_DONE
                                : RequestStateCode.FINISHED;
                        if (requestedPage === 1) {
                            // 首页
                            draft[type].data = result?.data ?? [];
                        } else {
                            draft[type].data = (draft[type].data ?? []).concat(
                                result?.data ?? [],
                            );
                        }
                    }),
                );
            } catch (e) {
                errorLog("拉取作者信息失败", e);
                if (requestGenerationRef.current !== requestGeneration) {
                    return;
                }
                setQueryResults(
                    produce(draft => {
                        draft[type].state = RequestStateCode.ERROR;
                    }),
                );
            }
        },
        [pluginHash, setQueryResults],
    );

    return queryArtist;
}
