import { useEffect, useMemo, useState } from "react";
import type { Plugin } from "@/core/pluginManager";

export interface IHomeDiscoveryPreview {
    topListPluginHash?: string;
    topListPluginName?: string;
    topLists: IMusic.IMusicSheetItemBase[];
    loading: boolean;
    hasError: boolean;
}

const defaultState: IHomeDiscoveryPreview = {
    topLists: [],
    loading: false,
    hasError: false,
};

function flattenTopLists(groups: IMusic.IMusicSheetGroupItem[]) {
    return groups.flatMap(group => group.data ?? []);
}

export default function useHomeDiscovery(topListPlugins: Plugin[]) {
    const topListPlugin = topListPlugins[0] ?? null;
    const topListPluginHash = topListPlugin?.hash;
    const topListPluginName = topListPlugin?.name;

    const [state, setState] = useState<IHomeDiscoveryPreview>(defaultState);

    useEffect(() => {
        let canceled = false;

        if (!topListPlugin) {
            setState(defaultState);
            return () => {
                canceled = true;
            };
        }

        setState({
            ...defaultState,
            topListPluginHash,
            topListPluginName,
            loading: true,
        });

        async function query() {
            let topLists: IMusic.IMusicSheetItemBase[] = [];
            let hasError = false;

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
                    topListPluginHash,
                    topListPluginName,
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
    }, [topListPlugin, topListPluginHash, topListPluginName]);

    return useMemo(() => state, [state]);
}
