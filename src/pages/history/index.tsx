import React from "react";
import musicHistory, { useMusicHistory } from "@/core/musicHistory";
import MusicList from "@/components/musicList";
import { musicHistorySheetId, RequestStateCode } from "@/constants/commonConst";
import AppBar from "@/components/base/appBar";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useI18N } from "@/core/i18n";
import { useCurrentMusic } from "@/core/trackPlayer";
import {
    ShortcutPageSurface,
    ShortcutStatusBar,
} from "@/components/base/shortcutPageSurface";

export default function History() {
    const musicHistoryList = useMusicHistory();
    const currentMusic = useCurrentMusic();

    const navigate = useNavigate();
    const { t } = useI18N();

    return (
        <ShortcutPageSurface>
            <ShortcutStatusBar />
            <AppBar
                backgroundColor="transparent"
                spacious
                menu={[
                    {
                        icon: "trash-outline",
                        title: t("history.clearHistory"),
                        onPress() {
                            if (musicHistoryList.length) {
                                musicHistory.clearMusic();
                            }
                        },
                    },
                    {
                        icon: "pencil-square",
                        title: t("common.edit"),
                        onPress() {
                            navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                                musicList: musicHistoryList,
                                musicSheet: {
                                    id: musicHistorySheetId,
                                    title: t("history.title"),
                                },
                            });
                        },
                    },
                ]}>
                {t("history.title")}
            </AppBar>
            <MusicList
                musicList={musicHistoryList}
                showIndex
                showArtwork
                showQuality
                showDuration
                presentation="cards"
                state={RequestStateCode.IDLE}
                highlightMusicItem={currentMusic}
                musicSheet={{
                    id: musicHistorySheetId,
                    title: t("history.title"),
                    musicList: musicHistoryList,
                } as IMusic.IMusicSheetItem}
            />
        </ShortcutPageSurface>
    );
}
