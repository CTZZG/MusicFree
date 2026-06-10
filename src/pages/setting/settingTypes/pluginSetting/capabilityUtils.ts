import type { ILanguageData } from "@/types/core/i18n";
import type { Plugin } from "@/core/pluginManager";
import type { useI18N } from "@/core/i18n";

export interface IPluginCapabilityConfig {
    key: string;
    labelKey: keyof ILanguageData;
    methods: Array<keyof IPlugin.IPluginInstanceMethods>;
}

export type IPluginSettingTranslate = ReturnType<typeof useI18N>["t"];

export const pluginCapabilityConfigs: IPluginCapabilityConfig[] = [
    {
        key: "search",
        labelKey: "home.sourceCapability.search",
        methods: ["search"],
    },
    {
        key: "source",
        labelKey: "home.sourceCapability.source",
        methods: ["getMediaSource"],
    },
    {
        key: "lyric",
        labelKey: "home.sourceCapability.lyric",
        methods: ["getLyric"],
    },
    {
        key: "wordLyric",
        labelKey: "home.sourceCapability.wordLyric",
        methods: ["getWordByWordLyric"],
    },
    {
        key: "topList",
        labelKey: "home.sourceCapability.topList",
        methods: ["getTopLists", "getTopListDetail"],
    },
    {
        key: "recommend",
        labelKey: "home.sourceCapability.recommend",
        methods: ["getRecommendSheetTags", "getRecommendSheetsByTag"],
    },
    {
        key: "album",
        labelKey: "home.sourceCapability.album",
        methods: ["getAlbumInfo"],
    },
    {
        key: "artist",
        labelKey: "home.sourceCapability.artist",
        methods: ["getArtistWorks"],
    },
    {
        key: "import",
        labelKey: "home.sourceCapability.import",
        methods: ["importMusicItem", "importMusicSheet"],
    },
    {
        key: "comment",
        labelKey: "home.sourceCapability.comment",
        methods: ["getMusicComments"],
    },
    {
        key: "sync",
        labelKey: "pluginSetting.pluginItem.capability.sync",
        methods: ["syncMusicSheet"],
    },
];

export function getPluginSourceInfo(
    plugin: Plugin,
    t: IPluginSettingTranslate,
) {
    if (plugin.instance.srcUrl) {
        return {
            label: t("pluginSetting.pluginItem.source.network"),
            detail: plugin.instance.srcUrl as string,
        };
    }
    if (plugin.path) {
        return {
            label: t("pluginSetting.pluginItem.source.localFile"),
            detail: plugin.path as string,
        };
    }
    return {
        label: t("pluginSetting.pluginItem.source.unknown"),
        detail: "",
    };
}

export function pluginSupportsCapability(
    plugin: Plugin,
    capability: IPluginCapabilityConfig,
) {
    return capability.methods.some(method => plugin.supportedMethods.has(method));
}

export function getPluginCapabilityLabels(
    plugin: Plugin,
    t: IPluginSettingTranslate,
) {
    return pluginCapabilityConfigs
        .filter(config => pluginSupportsCapability(plugin, config))
        .map(config => t(config.labelKey));
}
