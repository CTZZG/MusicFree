import { useEffect, useMemo, useState } from "react";
import type { Plugin } from "@/core/pluginManager";

export interface IHomeDiscoveryPreview {
    recommendPluginHash?: string;
    recommendPluginName?: string;
    recommendSheets: IMusic.IMusicSheetItemBase[];
    topListPluginHash?: string;
    topListPluginName?: string;
    topLists: IMusic.IMusicSheetItemBase[];
    loading: boolean;
    hasError: boolean;
}

const defaultState: IHomeDiscoveryPreview = {
    recommendSheets: [],
    topLists: [],
    loading: false,
    hasError: false,
};

function flattenTopLists(groups: IMusic.IMusicSheetGroupItem[]) {
    return groups.flatMap(group => group.data ?? []);
}

export default function useHomeDiscovery(
    recommendPlugins: Plugin[],
    topListPlugins: Plugin[],
) {
    const recommendPlugin = recommendPlugins[0] ?? null;
    const topListPlugin = topListPlugins[0] ?? null;
    const recommendPluginHash = recommendPlugin?.hash;
    const topListPluginHash = topListPlugin?.hash;

    const [state, setState] = useState<IHomeDiscoveryPreview>(defaultState);

    useEffect(() => {
        let canceled = false;

        if (!recommendPlugin && !topListPlugin) {
            setState(defaultState);
            return () => {
                canceled = true;
            };
        }

        setState({
            ...defaultState,
            recommendPluginHash,
            recommendPluginName: recommendPlugin?.name,
            topListPluginHash,
            topListPluginName: topListPlugin?.name,
            loading: true,
        });

        async function query() {
            let recommendSheets: IMusic.IMusicSheetItemBase[] = [];
            let topLists: IMusic.IMusicSheetItemBase[] = [];
            let hasError = false;

            if (recommendPlugin) {
                try {
                    const result =
                        await recommendPlugin.methods.getRecommendSheetsByTag(
                            {
                                id: "",
                                title: "",
                            },
                            1,
                        );
                    recommendSheets = (result?.data ?? []).slice(0, 6);
                } catch {
                    hasError = true;
                }
            }

            if (topListPlugin) {
                try {
                    const result = await topListPlugin.methods.getTopLists();
                    topLists = flattenTopLists(result ?? []).slice(0, 6);
                } catch {
                    hasError = true;
                }
            }

            if (!canceled) {
                setState({
                    recommendPluginHash,
                    recommendPluginName: recommendPlugin?.name,
                    recommendSheets,
                    topListPluginHash,
                    topListPluginName: topListPlugin?.name,
                    topLists,
                    loading: false,
                    hasError,
                });
            }
        }

        query();

        return () => {
            canceled = true;
        };
    }, [recommendPlugin, recommendPluginHash, topListPlugin, topListPluginHash]);

    return useMemo(() => state, [state]);
}
