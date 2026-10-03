import React from "react";
import PlayAllBar from "@/components/base/playAllBar";
import SheetHeader from "@/components/base/sheetHeader";
import { useI18N } from "@/core/i18n";

interface IHeaderProps {
    musicSheet: IMusic.IMusicSheetItem | null;
    musicList: IMusic.IMusicItem[] | null;
    canStar?: boolean;
}

/** 插件歌单、专辑、榜单详情页的头部 */
export default function Header(props: IHeaderProps) {
    const { musicSheet, musicList, canStar } = props;
    const { t } = useI18N();
    const count = musicSheet?.worksNum ?? musicList?.length;

    return (
        <SheetHeader
            artwork={musicSheet?.artwork ?? musicSheet?.coverImg}
            title={musicSheet?.title}
            subtitle={musicSheet?.artist}
            meta={
                count === undefined
                    ? undefined
                    : t("sheetDetail.totalMusicCount", { count })
            }
            description={musicSheet?.description}>
            <PlayAllBar
                canStar={canStar}
                musicList={musicList}
                musicSheet={musicSheet}
            />
        </SheetHeader>
    );
}
