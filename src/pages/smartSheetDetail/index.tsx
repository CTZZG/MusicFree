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
import React, { useMemo } from "react";

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

export default function SmartSheetDetail() {
    const { type, platform, value } = useParams<"smart-sheet-detail">();
    const { t } = useI18N();
    const musicList = useSmartSheetMusicList(type, platform, value);
    const title = getSmartSheetTitle(t, type, platform, value);
    const navMenu = useMemo(
        () => [
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
        [musicList, t, title],
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
