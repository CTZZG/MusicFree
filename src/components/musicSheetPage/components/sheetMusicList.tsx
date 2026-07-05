import React from "react";
import { View } from "react-native";

import Loading from "@/components/base/loading";
import Header from "./header";
import MusicList from "@/components/musicList";
import Config from "@/core/appConfig";
import globalStyle from "@/constants/globalStyle";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import TrackPlayer, { useCurrentMusic } from "@/core/trackPlayer";
import { RequestStateCode } from "@/constants/commonConst";

interface IMusicListProps {
    sheetInfo: IMusic.IMusicSheetItem | null;
    musicList?: IMusic.IMusicItem[] | null;
    // 是否可收藏
    canStar?: boolean;
    // 状态
    state: RequestStateCode;
    onRetry?: () => void;
    onLoadMore?: () => void;
    showArtwork?: boolean;
}
export default function SheetMusicList(props: IMusicListProps) {
    const {
        sheetInfo,
        musicList,
        canStar,
        state,
        onRetry,
        onLoadMore,
        showArtwork,
    } = props;
    const currentMusic = useCurrentMusic();

    return (
        <View style={globalStyle.fwflex1}>
            {!musicList ? (
                <Loading />
            ) : (
                <HorizontalSafeAreaView style={globalStyle.fwflex1}>
                    <MusicList
                        showIndex
                        Header={
                            <Header
                                canStar={canStar}
                                musicSheet={sheetInfo}
                                musicList={musicList}
                            />
                        }
                        onLoadMore={onLoadMore}
                        onRetry={onRetry}
                        state={state}
                        musicList={musicList}
                        highlightMusicItem={currentMusic}
                        showArtwork={showArtwork}
                        onItemPress={(musicItem, currentMusicList) => {
                            if (
                                Config.getConfig(
                                    "basic.clickMusicInAlbum",
                                ) === "playMusic"
                            ) {
                                TrackPlayer.play(musicItem);
                            } else {
                                TrackPlayer.playWithReplacePlayList(
                                    musicItem,
                                    currentMusicList ?? [musicItem],
                                );
                            }
                        }}
                    />
                </HorizontalSafeAreaView>
            )}
        </View>
    );
}
