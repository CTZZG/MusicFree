import React from "react";
import { StyleSheet, View } from "react-native";
import SeekBar from "./seekBar";
import PlayControl from "./playControl";
import PlayerActions from "./actions";
import useOrientation from "@/hooks/useOrientation";
import { SharedValue } from "react-native-reanimated";

interface IBottomProps {
    swipeProgress: SharedValue<number>;
    tab: "album" | "lyric";
    onTabChange(tab: "album" | "lyric"): void;
}

/** 播放页下半部分：进度条、播放控制、操作栏 */
export default function Bottom(props: IBottomProps) {
    const { swipeProgress, tab, onTabChange } = props;
    const orientation = useOrientation();

    if (orientation === "horizontal") {
        return (
            <View style={styles.horizontalWrapper}>
                <SeekBar />
                <PlayControl swipeProgress={swipeProgress} />
                <PlayerActions />
            </View>
        );
    }

    return (
        <View style={styles.portraitWrapper}>
            <SeekBar />
            <PlayControl swipeProgress={swipeProgress} />
            <PlayerActions
                lyricTab={{
                    showingLyric: tab === "lyric",
                    toggle: () =>
                        onTabChange(tab === "lyric" ? "album" : "lyric"),
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    portraitWrapper: {
        width: "100%",
        paddingBottom: 12,
    },
    horizontalWrapper: {
        width: "100%",
        paddingBottom: 8,
    },
});
