import React, { memo, useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    AppState,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import rpx from "@/utils/rpx";
import Svg, { Circle } from "react-native-svg";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showPanel } from "../panels/usePanel";
import useColors from "@/hooks/useColors";
import TrackPlayer, {
    useCurrentMusic,
    useMusicState,
    useProgress,
} from "@/core/trackPlayer";
import Theme from "@/core/theme";
import { useAppConfig } from "@/core/appConfig";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import GlassBackdrop from "@/components/base/glassBackdrop";
import LiquidGlassBackdrop, {
    isLiquidGlassAvailable,
} from "@/components/base/liquidGlassBackdrop";
import MusicInfo from "./musicInfo";
import Icon from "@/components/base/icon.tsx";
import PlayingIndicator from "@/components/base/playingIndicator";
import {
    MUSIC_BAR_FLOATING_BOTTOM,
    MUSIC_BAR_HEIGHT,
    MUSIC_BAR_HORIZONTAL_MARGIN,
} from "./layout";
import { useMusicBarLayoutState } from "./layoutState";

function CircularPlayBtn() {
    const progress = useProgress();
    const musicState = useMusicState();
    const colors = useColors();
    const musicItem = useCurrentMusic();

    const isPaused = musicIsPaused(musicState);
    const isBuffering = musicIsBuffering(musicState);
    const indicatorColor = colors.musicBarText ?? colors.text ?? "#ffffff";

    if (isBuffering) {
        return (
            <View style={styles.bufferingContainer}>
                <ActivityIndicator size={rpx(52)} color={colors.musicBarText} />
            </View>
        );
    }

    const displayDuration =
        progress.duration > 0 ? progress.duration : musicItem?.duration ?? 0;
    const playProgress = displayDuration
        ? Math.min(1, Math.max(0, progress.position / displayDuration))
        : 0;
    const ringSize = rpx(72);
    const strokeWidth = rpx(4);
    const inactiveStrokeWidth = rpx(2);
    const radius = (ringSize - strokeWidth) / 2;
    const center = ringSize / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <View style={styles.playButtonContainer}>
            <Svg
                width={ringSize}
                height={ringSize}
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                style={styles.playProgressRing}
                pointerEvents="none">
                <Circle
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={colors.textSecondary}
                    strokeWidth={inactiveStrokeWidth}
                    strokeOpacity={0.2}
                    fill="none"
                />
                <Circle
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={colors.musicBarText}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference} ${circumference}`}
                    strokeDashoffset={circumference * (1 - playProgress)}
                    transform={`rotate(-90 ${center} ${center})`}
                />
            </Svg>
            <Pressable
                accessibilityLabel={"播放或暂停歌曲"}
                hitSlop={{
                    top: 10,
                    left: 10,
                    right: 10,
                    bottom: 10,
                }}
                style={styles.playButtonPressable}
                onPress={async () => {
                    if (isPaused) {
                        await TrackPlayer.play();
                    } else {
                        await TrackPlayer.pause();
                    }
                }}>
                {isPaused ? (
                    <Icon
                        name="play"
                        size={rpx(34)}
                        color={colors.musicBarText}
                    />
                ) : (
                    <PlayingIndicator
                        active
                        size={rpx(34)}
                        color={indicatorColor}
                    />
                )}
            </Pressable>
        </View>
    );
}
function MusicBar() {
    const musicItem = useCurrentMusic();
    const [liquidSurfaceRefreshToken, setLiquidSurfaceRefreshToken] =
        useState(0);
    const { layout, routeName, transitionInProgress } = useMusicBarLayoutState();

    const colors = useColors();
    const isFrostedGlass = Theme.useTheme().id === "p-frosted-glass";
    const musicBarLiquidGlass =
        useAppConfig("theme.musicBarLiquidGlass") ?? false;
    const useLiquidGlass =
        layout.visible &&
        isFrostedGlass &&
        musicBarLiquidGlass &&
        isLiquidGlassAvailable();
    const safeAreaInsets = useSafeAreaInsets();
    const hasMusicItem = layout.visible && !!musicItem;

    const refreshLiquidSurface = useCallback(() => {
        setLiquidSurfaceRefreshToken(value => value + 1);
    }, []);

    useEffect(() => {
        if (!useLiquidGlass || !hasMusicItem || transitionInProgress) {
            return;
        }

        // A native-stack transition animates surfaces with transforms, which
        // does not guarantee another layout/scroll callback after the final
        // frame. Capture immediately when the committed route changes, then
        // take two settled samples so a mid-transition bitmap cannot linger.
        refreshLiquidSurface();
        const timers = [120, 320].map(delay =>
            setTimeout(refreshLiquidSurface, delay),
        );

        return () => {
            timers.forEach(clearTimeout);
        };
    }, [
        hasMusicItem,
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

    const barContent = musicItem ? (
        <>
            <MusicInfo musicItem={musicItem} />
            <View style={styles.actionGroup}>
                <CircularPlayBtn />
                <Icon
                    accessible
                    accessibilityLabel="播放列表"
                    name="playlist"
                    size={rpx(56)}
                    onPress={() => {
                        showPanel("PlayList");
                    }}
                    color={colors.musicBarText}
                    style={[styles.actionIcon]}
                />
            </View>
        </>
    ) : null;

    if (!layout.visible || !musicItem) {
        return null;
    }

    if (useLiquidGlass) {
        return (
            <View
                style={[
                    styles.wrapper,
                    styles.glassWrapper,
                    styles.liquidWrapper,
                    {
                        bottom:
                            safeAreaInsets.bottom + MUSIC_BAR_FLOATING_BOTTOM,
                        paddingRight: safeAreaInsets.right + rpx(24),
                    },
                ]}
                accessible
                accessibilityLabel={`歌曲: ${musicItem.title} 歌手: ${musicItem.artist}`}>
                <LiquidGlassBackdrop
                    radius={rpx(66)}
                    refreshToken={liquidSurfaceRefreshToken}
                />
                {barContent}
            </View>
        );
    }

    return (
        <>
            {
                <View
                    style={[
                        styles.wrapper,
                        isFrostedGlass
                            ? styles.glassWrapper
                            : styles.dockedWrapper,
                        {
                            backgroundColor: isFrostedGlass
                                ? "transparent"
                                : colors.musicBar,
                            bottom:
                                safeAreaInsets.bottom +
                                (isFrostedGlass
                                    ? MUSIC_BAR_FLOATING_BOTTOM
                                    : 0),
                            borderTopColor: "transparent",
                            paddingRight: safeAreaInsets.right + rpx(24),
                        },
                    ]}
                    accessible
                    accessibilityLabel={`歌曲: ${musicItem.title} 歌手: ${musicItem.artist}`}
                    // onPress={() => {
                    //     navigate(ROUTE_PATH.MUSIC_DETAIL);
                    // }}
                >
                    {isFrostedGlass ? (
                        <GlassBackdrop radius={rpx(66)} intensity={60} />
                    ) : null}
                    {barContent}
                </View>
            }
        </>
    );
}

export default memo(MusicBar);

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: MUSIC_BAR_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        paddingRight: rpx(24),
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    glassWrapper: {
        position: "absolute",
        left: MUSIC_BAR_HORIZONTAL_MARGIN,
        right: MUSIC_BAR_HORIZONTAL_MARGIN,
        width: "auto",
        borderRadius: rpx(66),
        overflow: "hidden",
    },
    dockedWrapper: {
        position: "absolute",
        left: 0,
        right: 0,
    },
    liquidWrapper: {
        backgroundColor: "transparent",
        borderTopWidth: 0,
        borderTopColor: "transparent",
    },
    bufferingContainer: {
        width: rpx(72),
        height: rpx(72),
        justifyContent: "center",
        alignItems: "center",
    },
    playButtonContainer: {
        width: rpx(72),
        height: rpx(72),
        alignItems: "center",
        justifyContent: "center",
    },
    playProgressRing: {
        position: "absolute",
        left: 0,
        top: 0,
    },
    playButtonPressable: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    actionGroup: {
        width: rpx(200),
        justifyContent: "flex-end",
        flexDirection: "row",
        alignItems: "center",
    },
    actionIcon: {
        marginLeft: rpx(36),
    },
});
