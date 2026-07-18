import React, { useCallback, useEffect, useMemo, useRef } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Operations from "./operations";
import { showPanel } from "@/components/panels/usePanel.ts";
import SongInfo from "./songInfo";
import MiniLyric from "./miniLyric";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppConfig } from "@/core/appConfig";
import { musicIsPaused } from "@/utils/trackUtils";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { useMusicDetailVisuals } from "../../../artworkContext";
import { getMusicDetailHeroLayout } from "../../../heroLayout";
import { getMusicDetailCircleLayout } from "../../../circleLayout";

export const COVER_SIZE = rpx(500);
export const COVER_MARGIN = (rpx(750) - COVER_SIZE) / 2;

export function getCoverLeftMargin() {
    return COVER_MARGIN;
}

interface IProps {
    immersiveMode?: boolean;
    onTurnPageClick?: () => void;
}

export default function AlbumCover(props: IProps) {
    const { immersiveMode = false, onTurnPageClick } = props;

    const musicItem = useCurrentMusic();
    const { displayArtwork, coverArtwork, ambientArtwork } =
        useMusicDetailVisuals();
    const musicState = useMusicState();
    const orientation = useOrientation();
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const longPressTriggeredRef = useRef(false);

    const usableWindowHeight =
        windowHeight - safeAreaInsets.top - safeAreaInsets.bottom;
    const rotation = useSharedValue(0);
    const isCircleCover = coverStyle === "circle";
    const shouldRotateCover = isCircleCover && !musicIsPaused(musicState);
    const heroLayout = useMemo(
        () =>
            getMusicDetailHeroLayout({
                windowWidth,
                windowHeight,
                safeAreaTop: safeAreaInsets.top,
                safeAreaBottom: safeAreaInsets.bottom,
            }),
        [safeAreaInsets.bottom, safeAreaInsets.top, windowHeight, windowWidth],
    );
    const circleLayout = useMemo(
        () =>
            getMusicDetailCircleLayout({
                windowWidth,
                windowHeight,
                safeAreaTop: safeAreaInsets.top,
                safeAreaBottom: safeAreaInsets.bottom,
            }),
        [safeAreaInsets.bottom, safeAreaInsets.top, windowHeight, windowWidth],
    );

    const artworkStyle = useMemo(() => {
        const circleStyle = isCircleCover
            ? {
                borderRadius: rpx(999),
                overflow: "hidden" as const,
            }
            : {
                borderRadius: orientation === "vertical" ? rpx(6) : rpx(4),
                overflow: "hidden" as const,
            };
        if (orientation === "vertical") {
            const availableWidth = Math.max(rpx(360), windowWidth - rpx(24));
            const comfortableHeight = Math.max(
                rpx(420),
                usableWindowHeight * 0.43,
            );
            const coverSize = isCircleCover
                ? circleLayout.coverSize
                : Math.min(availableWidth, comfortableHeight);
            return {
                width: coverSize,
                height: coverSize,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: "rgba(255,255,255,0.28)",
                elevation: 12,
                ...circleStyle,
            };
        } else {
            return {
                width: rpx(260),
                height: rpx(260),
                ...circleStyle,
            };
        }
    }, [
        circleLayout.coverSize,
        isCircleCover,
        orientation,
        usableWindowHeight,
        windowWidth,
    ]);

    useEffect(() => {
        if (shouldRotateCover) {
            rotation.value = withRepeat(
                withTiming(rotation.value + 360, {
                    duration: 22000,
                    easing: Easing.linear,
                }),
                -1,
                false,
            );
        } else {
            cancelAnimation(rotation);
        }
    }, [rotation, shouldRotateCover]);

    useEffect(() => {
        rotation.value = 0;
    }, [musicItem?.id, musicItem?.platform, rotation]);

    const coverAnimatedStyle = useAnimatedStyle(() => ({
        transform: [
            {
                rotate: `${rotation.value}deg`,
            },
        ],
    }));

    const handlePress = useCallback(() => {
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
        }
        onTurnPageClick?.();
    }, [onTurnPageClick]);

    const handleLongPress = useCallback(() => {
        longPressTriggeredRef.current = true;
        const previewArtwork = coverArtwork || ambientArtwork;
        if (
            typeof previewArtwork === "string" &&
            previewArtwork.trim().length > 0
        ) {
            showPanel("ImageViewer", {
                url: previewArtwork,
            });
        }
    }, [ambientArtwork, coverArtwork]);

    if (orientation === "horizontal") {
        return (
            <View style={styles.horizontalRoot}>
                <Pressable
                    delayLongPress={500}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    style={styles.horizontalCoverArea}>
                    <View style={globalStyle.fullCenter}>
                        <Animated.View
                            style={[artworkStyle, coverAnimatedStyle]}>
                            <FastImage
                                style={styles.coverImage}
                                source={displayArtwork}
                                placeholderSource={ImgAsset.albumDefault}
                                transition={260}
                            />
                        </Animated.View>
                    </View>
                </Pressable>
                {immersiveMode ? null : <Operations />}
            </View>
        );
    }

    if (!isCircleCover) {
        return (
            <View style={[styles.verticalRoot, styles.heroVerticalRoot]}>
                <Pressable
                    delayLongPress={500}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    style={[styles.heroTapArea, { height: heroLayout.tapHeight }]}
                />
                <MiniLyric variant="hero" onPress={onTurnPageClick} />
                <SongInfo variant="hero" />
                {immersiveMode ? null : <Operations />}
            </View>
        );
    }

    return (
        <View
            style={[
                styles.circleVerticalRoot,
                {
                    paddingTop: circleLayout.navHeight + circleLayout.topGap,
                },
            ]}>
            <Pressable
                delayLongPress={500}
                onPress={handlePress}
                onLongPress={handleLongPress}
                style={[
                    styles.coverArea,
                    { height: circleLayout.coverSize + rpx(24) },
                ]}>
                <View style={styles.coverCenter}>
                    <Animated.View style={[artworkStyle, coverAnimatedStyle]}>
                        <FastImage
                            style={styles.coverImage}
                            source={displayArtwork}
                            placeholderSource={ImgAsset.albumDefault}
                            transition={260}
                        />
                    </Animated.View>
                </View>
            </Pressable>
            <View style={styles.circleSongInfo}>
                <SongInfo />
            </View>
            <MiniLyric variant="circle" onPress={onTurnPageClick} />
            <View style={globalStyle.flex1} />
            <View style={styles.circleOperationsArea}>
                {immersiveMode ? null : <Operations />}
            </View>
        </View>
    );
}

const styles = {
    verticalRoot: {
        width: "100%" as const,
        flex: 1,
    },
    heroVerticalRoot: {
        paddingBottom: rpx(64),
    },
    circleVerticalRoot: {
        width: "100%" as const,
        flex: 1,
    },
    coverArea: {
        width: "100%" as const,
        flexShrink: 0,
        justifyContent: "center" as const,
    },
    coverCenter: {
        width: "100%" as const,
        justifyContent: "center" as const,
        alignItems: "center" as const,
    },
    heroTapArea: {
        width: "100%" as const,
        flexShrink: 0,
    },
    circleSongInfo: {
        flexShrink: 0,
    },
    circleOperationsArea: {
        flexShrink: 0,
    },
    coverImage: {
        width: "100%" as const,
        height: "100%" as const,
    },
    horizontalRoot: {
        width: "100%" as const,
        flex: 1,
        justifyContent: "center" as const,
    },
    horizontalCoverArea: {
        width: "100%" as const,
        flex: 1,
        justifyContent: "center" as const,
    },
};
