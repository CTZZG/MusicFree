import React from "react";
import { View } from "react-native";
import Header from "./header";
import MusicList from "@/components/musicList";
import { useParams } from "@/core/router";
import globalStyle from "@/constants/globalStyle";
import MusicSheet, { useSheetItem } from "@/core/musicSheet";
import { useI18N } from "@/core/i18n";
import { RequestStateCode } from "@/constants/commonConst";
import { useCurrentMusic } from "@/core/trackPlayer";

export default function SheetMusicList() {
    const { id = "favorite" } = useParams<"local-sheet-detail">();
    const musicSheet = useSheetItem(id);
    const currentMusic = useCurrentMusic();
    const { t } = useI18N();

    return (
        <View style={globalStyle.flex1}>
            <MusicList
                Header={<Header />}
                musicList={musicSheet?.musicList}
                musicSheet={musicSheet}
                showIndex
                showArtwork
                showQuality
                showDuration
                state={RequestStateCode.IDLE}
                highlightMusicItem={currentMusic}
                // 空的「我喜欢」说明歌从哪来
                emptyDescription={
                    id === MusicSheet.defaultSheet.id
                        ? t("sheetDetail.favoriteEmptyHint")
                        : undefined
                }
            />
        </View>
    );
}
