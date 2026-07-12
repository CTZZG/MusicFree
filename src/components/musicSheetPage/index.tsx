import React from "react";
import NavBar from "./components/navBar";
import SheetMusicList from "./components/sheetMusicList";
import StatusBar from "@/components/base/statusBar";
import { ShortcutStatusBar } from "../base/shortcutPageSurface";
import globalStyle from "@/constants/globalStyle";
import VerticalSafeAreaView from "../base/verticalSafeAreaView";
import { RequestStateCode } from "@/constants/commonConst";
import { IIconName } from "../base/icon.tsx";

interface IMusicSheetPageProps {
    navTitle: string;
    sheetInfo: ICommon.WithMusicList<IMusic.IMusicSheetItemBase> | null;
    musicList?: IMusic.IMusicItem[] | null;
    // 是否可收藏
    canStar?: boolean;
    // 状态
    state: RequestStateCode;
    onRetry?: () => void;
    onLoadMore?: () => void;
    showArtwork?: boolean;
    showQuality?: boolean;
    showDuration?: boolean;
    navMenu?: Array<{
        icon: IIconName;
        title: string;
        show?: boolean;
        onPress?: () => void;
    }>;
    presentation?: "plain" | "cards";
}

export default function MusicSheetPage(props: IMusicSheetPageProps) {
    const {
        navTitle,
        sheetInfo,
        musicList,
        canStar,
        onLoadMore,
        onRetry,
        state,
        showArtwork,
        showQuality,
        showDuration,
        navMenu,
        presentation = "plain",
    } = props;

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            {presentation === "cards" ? <ShortcutStatusBar /> : <StatusBar />}
            <NavBar
                musicList={musicList ?? sheetInfo?.musicList ?? []}
                navTitle={navTitle}
                menu={navMenu}
                backgroundColor={presentation === "cards" ? "transparent" : undefined}
                spacious={presentation === "cards"}
            />
            <SheetMusicList
                canStar={canStar}
                sheetInfo={sheetInfo as any}
                musicList={musicList ?? sheetInfo?.musicList}
                state={state}
                onRetry={onRetry}
                onLoadMore={onLoadMore}
                showArtwork={showArtwork}
                showQuality={showQuality}
                showDuration={showDuration}
                presentation={presentation}
            />
        </VerticalSafeAreaView>
    );
}
