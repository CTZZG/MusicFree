import React from "react";
import { Pressable, StyleSheet } from "react-native";
import BufferingPauseIcon from "@/components/base/bufferingPauseIcon";
import Icon from "@/components/base/icon.tsx";
import { useI18N } from "@/core/i18n";
import TrackPlayer, { useMusicState } from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import { MUSIC_BAR_BUTTON_SIZE } from "./layout";

/** 迷你播放器上的播放暂停按钮 */
export default function MiniPlayButton() {
    const musicState = useMusicState();
    const colors = useColors();
    const { t } = useI18N();

    // 加载、缓冲中也能暂停：暂停后装好的文件不再自己出声（见 PlaybackIntent）
    if (musicIsBuffering(musicState)) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("musicBar.pauseWhileLoading.a11y")}
                accessibilityState={{ busy: true }}
                style={({ pressed }) => [
                    styles.barButton,
                    pressed ? styles.pressed : null,
                ]}
                onPress={async () => {
                    await TrackPlayer.pause();
                }}>
                <BufferingPauseIcon
                    ringSize={32}
                    iconSize={14}
                    color={colors.musicBarText}
                />
            </Pressable>
        );
    }

    const isPaused = musicIsPaused(musicState);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("musicBar.playPause.a11y")}
            style={({ pressed }) => [
                styles.barButton,
                pressed ? styles.pressed : null,
            ]}
            onPress={async () => {
                if (isPaused) {
                    await TrackPlayer.play();
                } else {
                    await TrackPlayer.pause();
                }
            }}>
            <Icon
                name={isPaused ? "play" : "pause"}
                size={26}
                color={colors.musicBarText}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    barButton: {
        width: MUSIC_BAR_BUTTON_SIZE,
        height: MUSIC_BAR_BUTTON_SIZE,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.5,
    },
});
