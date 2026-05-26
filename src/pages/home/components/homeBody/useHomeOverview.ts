import { localPluginHash, localPluginPlatform } from "@/constants/commonConst";
import { useDownloadQueue } from "@/core/downloader";
import LocalMusicSheet from "@/core/localMusicSheet";
import { useMusicHistory } from "@/core/musicHistory";
import MusicSheet, { useSheetsBase, useStarredSheets } from "@/core/musicSheet";
import PluginManager, { Plugin, useSortedPlugins } from "@/core/pluginManager";
import { useCurrentMusic, useMusicState, useProgress } from "@/core/trackPlayer";
import { isSameMediaItem } from "@/utils/mediaUtils";
import { useMemo } from "react";

export type HomeCapabilityKey =
    | "search"
    | "source"
    | "lyric"
    | "wordLyric"
    | "topList"
    | "recommend"
    | "album"
    | "artist"
    | "import"
    | "comment";

export interface IHomeSourceItem {
    key: string;
    name: string;
    pluginHash?: string;
    isLocal?: boolean;
    capabilities: HomeCapabilityKey[];
}

const capabilityDefs: {
    key: HomeCapabilityKey;
    method: keyof IPlugin.IPluginInstanceMethods;
}[] = [
    { key: "search", method: "search" },
    { key: "source", method: "getMediaSource" },
    { key: "lyric", method: "getLyric" },
    { key: "wordLyric", method: "getWordByWordLyric" },
    { key: "topList", method: "getTopLists" },
    { key: "recommend", method: "getRecommendSheetsByTag" },
    { key: "album", method: "getAlbumInfo" },
    { key: "artist", method: "getArtistWorks" },
    { key: "import", method: "importMusicSheet" },
    { key: "comment", method: "getMusicComments" },
];

function getCapabilities(plugin: Plugin): HomeCapabilityKey[] {
    return capabilityDefs
        .filter(def => plugin.supportedMethods.has(def.method))
        .map(def => def.key);
}

export default function useHomeOverview() {
    const sortedPlugins = useSortedPlugins();
    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const progress = useProgress();
    const history = useMusicHistory();
    const sheets = useSheetsBase();
    const starredSheets = useStarredSheets();
    const localMusicList = LocalMusicSheet.useMusicList();
    const downloadQueue = useDownloadQueue();

    const enabledPlugins = useMemo(
        () =>
            sortedPlugins.filter(plugin =>
                PluginManager.isPluginEnabled(plugin),
            ),
        [sortedPlugins],
    );

    const searchablePlugins = useMemo(
        () =>
            enabledPlugins.filter(plugin =>
                plugin.supportedMethods.has("search"),
            ),
        [enabledPlugins],
    );

    const sources = useMemo<IHomeSourceItem[]>(() => {
        const pluginSources = enabledPlugins.map(plugin => ({
            key: plugin.hash,
            name: plugin.name,
            pluginHash: plugin.hash,
            capabilities: getCapabilities(plugin),
        }));

        return [
            ...pluginSources,
            {
                key: localPluginHash,
                name: localPluginPlatform,
                isLocal: true,
                capabilities: ["source", "lyric"],
            },
        ];
    }, [enabledPlugins]);

    const sourceChips = useMemo<IHomeSourceItem[]>(
        () => [
            {
                key: "all",
                name: "all",
                capabilities: [],
            },
            ...searchablePlugins.slice(0, 8).map(plugin => ({
                key: plugin.hash,
                name: plugin.name,
                pluginHash: plugin.hash,
                capabilities: getCapabilities(plugin),
            })),
            {
                key: localPluginHash,
                name: localPluginPlatform,
                isLocal: true,
                capabilities: ["source", "lyric"],
            },
        ],
        [searchablePlugins],
    );

    const recommendPlugins = useMemo(
        () =>
            enabledPlugins.filter(plugin =>
                plugin.supportedMethods.has("getRecommendSheetsByTag"),
            ),
        [enabledPlugins],
    );

    const topListPlugins = useMemo(
        () =>
            enabledPlugins.filter(plugin =>
                plugin.supportedMethods.has("getTopLists"),
            ),
        [enabledPlugins],
    );

    const featuredMusic = currentMusic ?? history[0] ?? null;

    const recentMusics = useMemo(
        () =>
            history
                .filter(item =>
                    currentMusic ? !isSameMediaItem(item, currentMusic) : true,
                )
                .slice(0, 3),
        [currentMusic, history],
    );

    const favoriteSheet = useMemo(
        () =>
            sheets.find(sheet => sheet.id === MusicSheet.defaultSheet.id) ??
            sheets[0] ??
            null,
        [sheets],
    );

    const userSheets = useMemo(
        () =>
            sheets
                .filter(sheet => sheet.id !== MusicSheet.defaultSheet.id)
                .slice(0, 3),
        [sheets],
    );

    return {
        currentMusic,
        musicState,
        progress,
        featuredMusic,
        recentMusics,
        history,
        sources,
        sourceChips,
        enabledPlugins,
        searchablePlugins,
        recommendPlugins,
        topListPlugins,
        sheets,
        starredSheets,
        favoriteSheet,
        userSheets,
        localMusicList,
        downloadQueue,
    };
}
