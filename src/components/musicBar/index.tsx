import React, { memo, useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    AppState,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showPanel } from "../panels/usePanel";
import useColors from "@/hooks/useColors";
import TrackPlayer, { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import Theme from "@/core/theme";
import { useAppConfig } from "@/core/appConfig";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import GlassBackdrop from "@/components/base/glassBackdrop";
import LiquidGlassBackdrop, {
    isLiquidGlassAvailable,
} from "@/components/base/liquidGlassBackdrop";
import MusicInfo from "./musicInfo";
import Icon from "@/components/base/icon.tsx";
import { MUSIC_BAR_HEIGHT, MUSIC_BAR_HORIZONTAL_MARGIN } from "./layout";
import { useMusicBarLayoutState } from "./layoutState";
import { useI18N } from "@/core/i18n";

const BAR_RADIUS = MUSIC_BAR_HEIGHT / 2;
// 从标签页进入二级页面时，迷你播放器从标签栏上方滑到底部
const MOVE_TIMING = {
    duration: 220,
    easing: Easing.out(Easing.cubic),
};

function MiniPlayButton() {
    const musicState = useMusicState();
    const colors = useColors();
    const { t } = useI18N();

    if (musicIsBuffering(musicState)) {
        return (
            <View style={styles.barButton}>
                <ActivityIndicator size="small" color={colors.musicBarText} />
            </View>
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
                size={24}
                color={colors.musicBarText}
            />
        </Pressable>
    );
}

function MusicBar() {
    const musicItem = useCurrentMusic();
    const { t } = useI18N();
    const [liquidSurfaceRefreshToken, setLiquidSurfaceRefreshToken] =
        useState(0);
    const { layout, routeName, activeTab, transitionInProgress } =
        useMusicBarLayoutState();

    const colors = useColors();
    const dark = Theme.useTheme().dark;
    const musicBarLiquidGlass =
        useAppConfig("theme.musicBarLiquidGlass") ?? false;
    // 原生液态玻璃的色调与折射只调过浅色，深色下用普通毛玻璃
    const useLiquidGlass =
        layout.visible &&
        !dark &&
        musicBarLiquidGlass &&
        isLiquidGlassAvailable();
    const safeAreaInsets = useSafeAreaInsets();
    const hasMusicItem = layout.visible && !!musicItem;

    // 底边位置用位移动画，标签栏出现/消失时迷你播放器平滑上下移动
    const barLift = useSharedValue(layout.barBottom);
    useEffect(() => {
        barLift.value = withTiming(layout.barBottom, MOVE_TIMING);
    }, [barLift, layout.barBottom]);
    const liftStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -barLift.value }],
    }));

    const refreshLiquidSurface = useCallback(() => {
        setLiquidSurfaceRefreshToken(value => value + 1);
    }, []);

    useEffect(() => {
        if (!useLiquidGlass || !hasMusicItem || transitionInProgress) {
            return;
        }

        // A native-stack transition animates surfaces with transforms, which
        // does not guarantee another layout/scroll callback after the final
        // frame. Capture immediately when the committed route or home tab
        // changes, then take two settled samples (after the lift animation)
        // so a mid-transition bitmap cannot linger.
        refreshLiquidSurface();
        const timers = [120, 320].map(delay =>
            setTimeout(refreshLiquidSurface, delay),
        );

        return () => {
            timers.forEach(clearTimeout);
        };
    }, [
        activeTab,
        hasMusicItem,
        layout.barBottom,
        refreshLiquidSurface,
        routeName,
        transitionInProgress,
        useLiquidGlass,
    ]);

    useEffect(() => {
        if (!useLiquidGlass || transitionInProgress) {
            return;
        }

        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const appStateSubscription = AppState.addEventListener(
            "change",
            nextState => {
                if (nextState === "active") {
                    if (refreshTimer) {
                        clearTimeout(refreshTimer);
                    }
                    refreshTimer = setTimeout(() => {
                        refreshLiquidSurface();
                        refreshTimer = null;
                    }, 160);
                }
            },
        );

        return () => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
            appStateSubscription.remove();
        };
    }, [refreshLiquidSurface, transitionInProgress, useLiquidGlass]);

    if (!layout.visible || !musicItem) {
        return null;
    }

    return (
        <Animated.View
            style={[
                styles.wrapper,
                {
                    bottom: safeAreaInsets.bottom,
                    left: MUSIC_BAR_HORIZONTAL_MARGIN + safeAreaInsets.left,
                    right: MUSIC_BAR_HORIZONTAL_MARGIN + safeAreaInsets.right,
                },
                liftStyle,
            ]}>
            {useLiquidGlass ? (
                <LiquidGlassBackdrop
                    radius={BAR_RADIUS}
                    refreshToken={liquidSurfaceRefreshToken}
                />
            ) : (
                <GlassBackdrop radius={BAR_RADIUS} intensity={60} />
            )}
            <MusicInfo musicItem={musicItem} />
            <MiniPlayButton />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("musicBar.playlist.a11y")}
                style={({ pressed }) => [
                    styles.barButton,
                    pressed ? styles.pressed : null,
                ]}
                onPress={() => {
                    showPanel("PlayList");
                }}>
                <Icon name="playlist" size={24} color={colors.musicBarText} />
            </Pressable>
        </Animated.View>
    );
}

export default memo(MusicBar);

const styles = StyleSheet.create({
    wrapper: {
        position: "absolute",
        height: MUSIC_BAR_HEIGHT,
        borderRadius: BAR_RADIUS,
        overflow: "hidden",
        flexDirection: "row",
        alignItems: "center",
        paddingRight: 6,
        // 底色交给玻璃背板，容器本身保持透明
        backgroundColor: "transparent",
    },
    barButton: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.5,
    },
});
