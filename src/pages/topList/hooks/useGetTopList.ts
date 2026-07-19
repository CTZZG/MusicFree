import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import { produce } from "immer";
import { getDefaultStore, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import { pluginsTopListAtom } from "../store/atoms";

export const TOP_LIST_CACHE_TTL = 30 * 60 * 1000;

export function isTopListCacheFresh(updatedAt?: number) {
    return Boolean(updatedAt && Date.now() - updatedAt < TOP_LIST_CACHE_TTL);
}

interface IGetTopListOptions {
    force?: boolean;
}

export default function useGetTopList() {
    const setPluginsTopList = useSetAtom(pluginsTopListAtom);
    const requestGenerationRef = useRef<Record<string, number>>({});

    const getTopList = useCallback(
        async (pluginHash: string, options: IGetTopListOptions = {}) => {
            let requestGeneration: number | undefined;
            try {
                const currentTopList =
                    getDefaultStore().get(pluginsTopListAtom)[pluginHash];
                if (
                    !options.force &&
                    currentTopList?.state === RequestStateCode.FINISHED &&
                    isTopListCacheFresh(currentTopList.updatedAt)
                ) {
                    return;
                }

                if (
                    currentTopList?.state === RequestStateCode.PENDING_REST_PAGE
                ) {
                    return;
                }

                const plugin = PluginManager.getByHash(pluginHash);
                if (!plugin) {
                    return;
                }

                requestGeneration =
                    (requestGenerationRef.current[pluginHash] ?? 0) + 1;
                requestGenerationRef.current[pluginHash] = requestGeneration;

                setPluginsTopList(
                    produce(draft => {
                        draft[pluginHash] = {
                            state: RequestStateCode.PENDING_REST_PAGE,
                            data: draft[pluginHash]?.data ?? [],
                            updatedAt: draft[pluginHash]?.updatedAt,
                        };
                    }),
                );
                const result = await plugin?.methods?.getTopLists();
                if (
                    requestGenerationRef.current[pluginHash] !==
                    requestGeneration
                ) {
                    return;
                }
                setPluginsTopList(
                    produce(draft => {
                        draft[pluginHash] = {
                            data: result,
                            state: RequestStateCode.FINISHED,
                            updatedAt: Date.now(),
                        };
                    }),
                );
            } catch {
                if (
                    requestGeneration === undefined ||
                    requestGenerationRef.current[pluginHash] !==
                        requestGeneration
                ) {
                    return;
                }
                setPluginsTopList(
                    produce(draft => {
                        draft[pluginHash] = {
                            data: draft[pluginHash]?.data ?? [],
                            updatedAt: draft[pluginHash]?.updatedAt,
                            state: RequestStateCode.ERROR,
                        };
                    }),
                );
            }
        },
        [setPluginsTopList],
    );

    return getTopList;
}
