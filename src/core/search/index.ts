import PluginManager, { Plugin } from "@/core/pluginManager";
import {
    ISearchSource,
    ISearchSourceProvider,
    SearchSession,
} from "./searchSession";

export * from "./searchSession";

function toSearchSource(plugin: Plugin | null | undefined): ISearchSource | null {
    // 缺少 hash 或 platform 的插件无法搜索，也无法区分结果
    if (!plugin?.hash || !plugin.instance?.platform) {
        return null;
    }
    return {
        hash: plugin.hash,
        name: plugin.name,
        defaultSearchType: plugin.instance.defaultSearchType,
        search: <T extends ICommon.SupportMediaType>(
            query: string,
            page: number,
            type: T,
        ) => plugin.methods.search(query, page, type),
    };
}

const pluginSearchSources: ISearchSourceProvider = {
    getSearchableSources: () =>
        PluginManager.getSearchablePlugins().map(toSearchSource),
    getSourceByHash: hash => toSearchSource(PluginManager.getByHash(hash)),
};

/** 搜索页共用的搜索会话 */
const searchSession = new SearchSession(pluginSearchSources);

export default searchSession;
