import React, { memo, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import Svg, { Circle } from "react-native-svg";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showPanel } from "../panels/usePanel";
import useColors from "@/hooks/useColors";
import TrackPlayer, { useCurrentMusic, useMusicState, useProgress } from "@/core/trackPlayer";
import Theme from "@/core/theme";
import { useAppConfig } from "@/core/appConfig";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import GlassBackdrop from "@/components/base/glassBackdrop";
import MusicInfo from "./musicInfo";
import Icon from "@/components/base/icon.tsx";
import PlayingIndicator from "@/components/base/playingIndicator";

// 液态玻璃是 Android-only 的原生 Compose 组件，模块缺失（iOS/旧安装包）时
// require 会抛错，静默回退到 expo-blur 磨砂
let LiquidGlassView: React.ComponentType<any> | null = null;
if (Platform.OS === "android") {
    try {
        LiquidGlassView =
            require("expo-liquid-glass-native").ExpoLiquidGlassNativeView;
    } catch {}
}

function CircularPlayBtn() {
    const progress = useProgress();
    const musicState = useMusicState();
    const colors = useColors();
    const musicItem = useCurrentMusic();

    const isPaused = musicIsPaused(musicState);
    const isBuffering = musicIsBuffering(musicState);
    const indicatorColor = colors.musicBarText ?? colors.text ?? "#ffffff";

    if (isBuffering) {
        return <View style={styles.bufferingContainer}>
            <ActivityIndicator size={rpx(52)} color={colors.musicBarText} />
        </View>;
    }

    const displayDuration = (progress.duration > 0) ? progress.duration : (musicItem?.duration ?? 0);
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

    const [showKeyboard, setKeyboardStatus] = useState(false);

    const colors = useColors();
    const isFrostedGlass = Theme.useTheme().id === "p-frosted-glass";
    const musicBarLiquidGlass =
        useAppConfig("theme.musicBarLiquidGlass") ?? false;
    const useLiquidGlass =
        isFrostedGlass && musicBarLiquidGlass && !!LiquidGlassView;
    const safeAreaInsets = useSafeAreaInsets();

    useEffect(() => {
        let keyboardResetTimer: ReturnType<typeof setTimeout> | null = null;
        const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
            setKeyboardStatus(true);
        });
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            setKeyboardStatus(false);
        });
        const appStateSubscription = AppState.addEventListener("change", nextState => {
            if (nextState !== "active") {
                setKeyboardStatus(false);
                return;
            }

            if (keyboardResetTimer) {
                clearTimeout(keyboardResetTimer);
            }
            Keyboard.dismiss();
            keyboardResetTimer = setTimeout(() => {
                setKeyboardStatus(false);
            }, 120);
        });

        return () => {
            if (keyboardResetTimer) {
                clearTimeout(keyboardResetTimer);
            }
            showSubscription.remove();
            hideSubscription.remove();
            appStateSubscription.remove();
        };
    }, []);

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

    if (musicItem && !showKeyboard && useLiquidGlass && LiquidGlassView) {
        return (
            <LiquidGlassView
                tint="#FFFFFF"
                blurRadius={6}
                cornerRadius={rpx(66)}
                style={styles.liquidBar}>
                <View
                    accessible
                    accessibilityLabel={`歌曲: ${musicItem.title} 歌手: ${musicItem.artist}`}
                    style={[
                        styles.liquidBarContent,
                        {
                            paddingRight: safeAreaInsets.right + rpx(24),
                        },
                    ]}>
                    {barContent}
                </View>
            </LiquidGlassView>
        );
    }

    return (
        <>
            {musicItem && !showKeyboard && (
                <View
                    style={[
                        styles.wrapper,
                        isFrostedGlass ? styles.glassWrapper : null,
                        {
                            backgroundColor: isFrostedGlass
                                ? "transparent"
                                : colors.musicBar,
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
            )}
        </>
    );
}

export default memo(MusicBar, () => true);

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: rpx(132),
        flexDirection: "row",
        alignItems: "center",
        paddingRight: rpx(24),
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    glassWrapper: {
        position: "absolute",
        left: rpx(24),
        right: rpx(24),
        bottom: rpx(20),
        width: "auto",
        borderRadius: rpx(66),
        overflow: "hidden",
    },
    liquidBar: {
        position: "absolute",
        left: rpx(24),
        right: rpx(24),
        bottom: rpx(20),
        height: rpx(132),
        borderRadius: rpx(66),
    },
    liquidBarContent: {
        height: rpx(132),
        flexDirection: "row",
        alignItems: "center",
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
