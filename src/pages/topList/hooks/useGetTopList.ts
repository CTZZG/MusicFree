import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import { produce } from "immer";
import { useAtom } from "jotai";
import { useCallback } from "react";
import { pluginsTopListAtom } from "../store/atoms";

export const TOP_LIST_CACHE_TTL = 30 * 60 * 1000;

export function isTopListCacheFresh(updatedAt?: number) {
    return Boolean(updatedAt && Date.now() - updatedAt < TOP_LIST_CACHE_TTL);
}

interface IGetTopListOptions {
    force?: boolean;
}

export default function useGetTopList() {
    const [pluginsTopList, setPluginsTopList] = useAtom(pluginsTopListAtom);

    const getTopList = useCallback(
        async (pluginHash: string, options: IGetTopListOptions = {}) => {
            try {
                const currentTopList = pluginsTopList[pluginHash];
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
        [pluginsTopList, setPluginsTopList],
    );

    return getTopList;
}
