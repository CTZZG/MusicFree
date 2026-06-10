import { localPluginPlatform } from "@/constants/commonConst";
import { getLocalPath, getMediaUniqueKey } from "@/utils/mediaUtils";
import { useMemo } from "react";
import LocalMusicSheet from "./localMusicSheet";
import { useMusicHistory } from "./musicHistory";
import MusicSheet, { useSheetsBase } from "./musicSheet";
import { useSortedPlugins } from "./pluginManager";

export type SmartSheetType =
    | "recent-played"
    | "recent-added"
    | "local"
    | "downloaded"
    | "plugin-source";

export interface ISmartSheetParams {
    type: SmartSheetType;
    platform?: string;
}

function dedupeMusicList(musicList: IMusic.IMusicItem[]) {
    const seen = new Set<string>();
    const result: IMusic.IMusicItem[] = [];

    for (let musicItem of musicList) {
        const key = getMediaUniqueKey(musicItem);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(musicItem);
        }
    }

    return result;
}

function getSheetMusicList() {
    return MusicSheet.backupSheets().flatMap(sheet => sheet.musicList ?? []);
}

function getRecentAddedMusicList() {
    return dedupeMusicList(
        getSheetMusicList()
            .filter(musicItem => Number(musicItem.$timestamp) > 0)
            .sort(
                (a, b) =>
                    Number(b.$timestamp) - Number(a.$timestamp) ||
                    (b.$sortIndex ?? 0) - (a.$sortIndex ?? 0),
            ),
    );
}

function getKnownMusicList(
    history: IMusic.IMusicItem[],
    localMusicList: IMusic.IMusicItem[],
) {
    return dedupeMusicList([
        ...history,
        ...localMusicList,
        ...getSheetMusicList(),
    ]);
}

export function useSmartSheetMusicList(
    type: SmartSheetType,
    platform?: string,
) {
    const history = useMusicHistory();
    const localMusicList = LocalMusicSheet.useMusicList();
    const sheetsBase = useSheetsBase();

    return useMemo(() => {
        if (type === "recent-played") {
            return history;
        }
        if (type === "recent-added") {
            return getRecentAddedMusicList();
        }
        if (type === "local") {
            return localMusicList;
        }
        if (type === "downloaded") {
            return localMusicList.filter(
                musicItem =>
                    musicItem.platform !== localPluginPlatform &&
                    !!getLocalPath(musicItem),
            );
        }
        if (type === "plugin-source" && platform) {
            return getKnownMusicList(history, localMusicList)
                .filter(musicItem => musicItem.platform === platform);
        }
        return [];
    }, [history, localMusicList, platform, sheetsBase, type]);
}

export function useSmartSheetSourcePlatforms() {
    const plugins = useSortedPlugins();
    const history = useMusicHistory();
    const localMusicList = LocalMusicSheet.useMusicList();
    const sheetsBase = useSheetsBase();

    return useMemo(() => {
        const platforms = new Set<string>();
        plugins.forEach(plugin => {
            if (plugin.name && plugin.name !== localPluginPlatform) {
                platforms.add(plugin.name);
            }
        });
        getKnownMusicList(history, localMusicList).forEach(musicItem => {
            if (musicItem.platform && musicItem.platform !== localPluginPlatform) {
                platforms.add(musicItem.platform);
            }
        });
        return [...platforms].sort((a, b) => a.localeCompare(b));
    }, [history, localMusicList, plugins, sheetsBase]);
}

export function getSmartSheetId(type: SmartSheetType, platform?: string) {
    return platform ? `smart-${type}-${platform}` : `smart-${type}`;
}
