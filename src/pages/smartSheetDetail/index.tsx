import MusicSheetPage from "@/components/musicSheetPage";
import { showPanel } from "@/components/panels/usePanel";
import { RequestStateCode, localPluginPlatform } from "@/constants/commonConst";
import { useI18N } from "@/core/i18n";
import MusicSheet from "@/core/musicSheet";
import { useParams } from "@/core/router";
import {
    getSmartSheetId,
    SmartSheetType,
    useSmartSheetMusicList,
} from "@/core/smartMusicSheet";
import Toast from "@/utils/toast";
import React, { useMemo, useState } from "react";

type SmartSheetSortMode = "default" | "title" | "artist" | "album";

function getSmartSheetTitle(
    t: ReturnType<typeof useI18N>["t"],
    type: SmartSheetType,
    platform?: string,
    value?: string,
) {
    if (type === "recent-played") {
        return t("smartSheet.recentPlayed");
    }
    if (type === "recent-added") {
        return t("smartSheet.recentAdded");
    }
    if (type === "most-played") {
        return t("smartSheet.mostPlayed");
    }
    if (type === "favorite") {
        return t("smartSheet.favorite");
    }
    if (type === "local") {
        return t("smartSheet.localMusic");
    }
    if (type === "downloaded") {
        return t("smartSheet.downloaded");
    }
    if (type === "plugin-source" && platform) {
        return t("smartSheet.pluginSourceTitle", { platform });
    }
    if (type === "artist" && value) {
        return t("smartSheet.artistTitle", { artist: value });
    }
    if (type === "album" && value) {
        return t("smartSheet.albumTitle", { album: value });
    }
    return t("smartSheet.title");
}

function sortSmartMusicList(
    musicList: IMusic.IMusicItem[],
    sortMode: SmartSheetSortMode,
) {
    if (sortMode === "default") {
        return musicList;
    }

    const getText = (musicItem: IMusic.IMusicItem, key: "title" | "artist" | "album") =>
        `${musicItem[key] ?? ""}`.trim();

    return [...musicList].sort((a, b) => {
        const left = getText(a, sortMode);
        const right = getText(b, sortMode);
        return (
            left.localeCompare(right) ||
            getText(a, "title").localeCompare(getText(b, "title")) ||
            getText(a, "artist").localeCompare(getText(b, "artist"))
        );
    });
}

export default function SmartSheetDetail() {
    const { type, platform, value } = useParams<"smart-sheet-detail">();
    const { t } = useI18N();
    const smartMusicList = useSmartSheetMusicList(type, platform, value);
    const [sortMode, setSortMode] = useState<SmartSheetSortMode>("default");
    const musicList = useMemo(
        () => sortSmartMusicList(smartMusicList, sortMode),
        [smartMusicList, sortMode],
    );
    const title = getSmartSheetTitle(t, type, platform, value);
    const navMenu = useMemo(
        () => [
            {
                icon: "sort-outline" as const,
                title: t("smartSheet.sort.title"),
                onPress() {
                    showPanel("SimpleSelect", {
                        header: t("smartSheet.sort.title"),
                        candidates: [
                            {
                                title: t("smartSheet.sort.default"),
                                value: "default",
                                icon: sortMode === "default"
                                    ? "check"
                                    : undefined,
                            },
                            {
                                title: t("smartSheet.sort.byTitle"),
                                value: "title",
                                icon: sortMode === "title"
                                    ? "check"
                                    : undefined,
                            },
                            {
                                title: t("smartSheet.sort.byArtist"),
                                value: "artist",
                                icon: sortMode === "artist"
                                    ? "check"
                                    : undefined,
                            },
                            {
                                title: t("smartSheet.sort.byAlbum"),
                                value: "album",
                                icon: sortMode === "album"
                                    ? "check"
                                    : undefined,
                            },
                        ],
                        onPress(item) {
                            setSortMode(item.value as SmartSheetSortMode);
                        },
                    });
                },
            },
            {
                icon: "folder-plus" as const,
                title: t("smartSheet.saveAsMusicSheet"),
                onPress() {
                    if (!musicList.length) {
                        Toast.warn(t("smartSheet.saveAsMusicSheetEmpty"));
                        return;
                    }
                    showPanel("CreateMusicSheet", {
                        defaultName: title,
                        async onSheetCreated(sheetId) {
                            try {
                                await MusicSheet.addMusic(sheetId, musicList);
                                Toast.success(t(
                                    "smartSheet.saveAsMusicSheetSuccess",
                                    { count: musicList.length },
                                ));
                            } catch {
                                Toast.warn(t("smartSheet.saveAsMusicSheetFailed"));
                            }
                        },
                    });
                },
            },
        ],
        [musicList, sortMode, t, title],
    );

    const sheetInfo = useMemo(
        () => ({
            id: getSmartSheetId(type, platform, value),
            platform: localPluginPlatform,
            title,
            worksNum: musicList.length,
            musicList,
        }),
        [musicList, platform, title, type, value],
    );

    return (
        <MusicSheetPage
            navTitle={title}
            sheetInfo={sheetInfo}
            musicList={musicList}
            canStar={false}
            navMenu={navMenu}
            state={RequestStateCode.IDLE}
        />
    );
}
