import { useAppConfig } from "@/core/appConfig";
import PluginManager, { useSortedPlugins } from "@/core/pluginManager";
import { useMemo } from "react";

interface IDiscoveryPlugin {
    name: string;
    supportedMethods: { has(method: string): boolean };
}

/**
 * 从已排序的插件里挑出能给首页提供推荐歌单或榜单的，再按记住的插件名选一个。
 * 记的是插件名而不是哈希（插件更新后哈希会变）；选过的插件被禁用或卸载时
 * 退回第一个可用插件。
 */
export function resolveHomeDiscoverySource<T extends IDiscoveryPlugin>(
    sortedPlugins: T[],
    storedName: string | undefined,
    isEnabled: (plugin: T) => boolean,
) {
    const candidates = sortedPlugins.filter(
        plugin =>
            isEnabled(plugin) &&
            (plugin.supportedMethods.has("getRecommendSheetsByTag") ||
                plugin.supportedMethods.has("getTopLists")),
    );
    const plugin =
        candidates.find(item => item.name === storedName) ??
        candidates[0] ??
        null;
    return { plugin, candidates };
}

/** 首页“推荐歌单 / 榜单”使用的音源 */
export default function useHomeDiscoverySource() {
    const sortedPlugins = useSortedPlugins();
    const storedName = useAppConfig("theme.homeDiscoverySource");

    return useMemo(
        () =>
            resolveHomeDiscoverySource(sortedPlugins, storedName, plugin =>
                PluginManager.isPluginEnabled(plugin),
            ),
        [sortedPlugins, storedName],
    );
}
