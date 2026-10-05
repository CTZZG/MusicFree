import PlayAllBar from "@/components/base/playAllBar";
import SheetHeader from "@/components/base/sheetHeader";
import { useI18N } from "@/core/i18n";
import MusicSheet, { useSheetItem } from "@/core/musicSheet";
import { useParams } from "@/core/router";
import React from "react";

/** 本地歌单详情页的头部 */
export default function Header() {
    const { id = "favorite" } = useParams<"local-sheet-detail">();
    const sheet = useSheetItem(id);
    const { t } = useI18N();
    const favorite = sheet?.id === MusicSheet.defaultSheet.id;

    return (
        <SheetHeader
            artwork={sheet?.coverImg}
            favorite={favorite}
            // 「我喜欢」存的名字是中文，跟着界面语言显示（和资料库里一致）
            title={favorite ? t("home.favoriteSheet") : sheet?.title}
            meta={t("sheetDetail.totalMusicCount", {
                count: sheet?.musicList?.length ?? 0,
            })}>
            <PlayAllBar musicList={sheet?.musicList} musicSheet={sheet} />
        </SheetHeader>
    );
}
