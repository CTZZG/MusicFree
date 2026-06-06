import React from "react";
import MusicItem from "@/components/mediaItem/musicItem";
import Config from "@/core/appConfig";
import { ISearchResult } from "@/pages/searchPage/store/atoms";
import TrackPlayer from "@/core/trackPlayer";
import { trace } from "@/utils/log";

interface IMusicResultsProps {
    item: IMusic.IMusicItem;
    index: number;
    pluginSearchResultRef: React.MutableRefObject<ISearchResult<"music">>;
}

export default function MusicResultItem(props: IMusicResultsProps) {
    const { item: musicItem, pluginSearchResultRef } = props;

    return (
        <MusicItem
            musicItem={musicItem}
            showArtwork
            showQuality
            showDuration
            onItemPress={() => {
                const clickBehavior = Config.getConfig(
                    "basic.clickMusicInSearch",
                );
                trace("SearchResult.musicItem press", {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                    title: musicItem.title,
                    clickBehavior,
                    playlistCount: pluginSearchResultRef?.current?.data?.length ?? 0,
                });
                if (clickBehavior === "playMusicAndReplace") {
                    const playlist = pluginSearchResultRef?.current?.data;
                    TrackPlayer.playWithReplacePlayList(
                        musicItem,
                        (playlist?.length ? playlist : [musicItem]) as IMusic.IMusicItem[],
                    );
                } else {
                    TrackPlayer.play(musicItem);
                }
            }}
        />
    );
}
