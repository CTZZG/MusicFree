import { useMemo } from "react";

import { localPluginPlatform } from "@/constants/commonConst";
import { getLocalPath } from "@/utils/mediaUtils";
import LocalMusicSheet from "./localMusicSheet";
import {
    useMusicHistory,
    useMusicPlayStats,
} from "./musicHistory";
import { useMusicSheetsSnapshot } from "./musicSheet";
import {
    buildSmartSheetLibrarySnapshot,
    ISmartSheetFacet,
    ISmartSheetLibrarySnapshot,
} from "./smartMusicSheetPolicy";

export type SmartSheetType =
    | "recommended"
    | "recent-played"
    | "recent-added"
    | "most-played"
    | "favorite"
    | "local"
    | "downloaded"
    | "plugin-source"
    | "artist"
    | "album";

export interface ISmartSheetParams {
    type: SmartSheetType;
    platform?: string;
    value?: string;
}

export type { ISmartSheetFacet, ISmartSheetLibrarySnapshot };

export function useSmartSheetLibrarySnapshot() {
    const history = useMusicHistory();
    const playStats = useMusicPlayStats();
    const localMusicList = LocalMusicSheet.useMusicList();
    const sheets = useMusicSheetsSnapshot();

    return useMemo(
        () =>
            buildSmartSheetLibrarySnapshot({
                history,
                playStats,
                localMusicList,
                downloadedMusicList: localMusicList.filter(
                    musicItem =>
                        musicItem.platform !== localPluginPlatform &&
                        !!getLocalPath(musicItem),
                ),
                localPluginPlatform,
                sheets,
            }),
        [history, localMusicList, playStats, sheets],
    );
}

export function getSmartSheetMusicList(
    snapshot: ISmartSheetLibrarySnapshot,
    type: SmartSheetType,
    platform?: string,
    value?: string,
) {
    if (type === "recommended") {
        return snapshot.recommended;
    }
    if (type === "recent-played") {
        return snapshot.recentPlayed;
    }
    if (type === "recent-added") {
        return snapshot.recentAdded;
    }
    if (type === "most-played") {
        return snapshot.mostPlayed;
    }
    if (type === "favorite") {
        return snapshot.favorite;
    }
    if (type === "local") {
        return snapshot.local;
    }
    if (type === "downloaded") {
        return snapshot.downloaded;
    }
    if (type === "plugin-source" && platform) {
        return snapshot.bySource.get(platform) ?? [];
    }
    if (type === "artist" && value) {
        return snapshot.byArtist.get(value) ?? [];
    }
    if (type === "album" && value) {
        return snapshot.byAlbum.get(value) ?? [];
    }
    return [];
}

export function useSmartSheetMusicList(
    type: SmartSheetType,
    platform?: string,
    value?: string,
) {
    const snapshot = useSmartSheetLibrarySnapshot();
    return useMemo(
        () => getSmartSheetMusicList(snapshot, type, platform, value),
        [platform, snapshot, type, value],
    );
}

export function useSmartSheetFacets(type: "artist" | "album") {
    const snapshot = useSmartSheetLibrarySnapshot();
    return type === "artist" ? snapshot.artistFacets : snapshot.albumFacets;
}

export function useSmartSheetSourceFacets() {
    return useSmartSheetLibrarySnapshot().sourceFacets;
}

export function useSmartSheetSourcePlatforms() {
    return useSmartSheetLibrarySnapshot().sourceFacets.map(item => item.value);
}

export function getSmartSheetId(
    type: SmartSheetType,
    platform?: string,
    value?: string,
) {
    const suffix = platform ?? value;
    return suffix ? `smart-${type}-${suffix}` : `smart-${type}`;
}
