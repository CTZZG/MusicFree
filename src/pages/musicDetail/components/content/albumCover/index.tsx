import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import {
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
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
import { useMusicDetailArtwork } from "../../../artworkContext";

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
    const artwork = useMusicDetailArtwork();
    const musicState = useMusicState();
    const orientation = useOrientation();
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const longPressTriggeredRef = useRef(false);
    const [containerHeight, setContainerHeight] = useState<number | null>(null);
    const [operationsBottom, setOperationsBottom] = useState<number | null>(null);

    const usableWindowHeight =
        windowHeight - safeAreaInsets.top - safeAreaInsets.bottom;
    const usableAspectRatio = usableWindowHeight / Math.max(1, windowWidth);
    const baseMiniLyricLayout = useMemo(() => {
        if (orientation !== "vertical") {
            return "normal" as const;
        }
        return usableAspectRatio < 1.9 ? ("compact" as const) : ("normal" as const);
    }, [orientation, usableAspectRatio]);
    const [miniLyricLayout, setMiniLyricLayout] = useState<
        "normal" | "compact" | "hidden"
    >(baseMiniLyricLayout);
    const rotation = useSharedValue(0);
    const isCircleCover = coverStyle === "circle";
    const shouldRotateCover = isCircleCover && !musicIsPaused(musicState);

    useEffect(() => {
        setMiniLyricLayout(baseMiniLyricLayout);
        setOperationsBottom(null);
    }, [baseMiniLyricLayout, windowHeight, windowWidth]);

    useEffect(() => {
        if (
            orientation !== "vertical" ||
            containerHeight === null ||
            operationsBottom === null
        ) {
            return;
        }
        if (operationsBottom > containerHeight + rpx(2)) {
            setOperationsBottom(null);
            setMiniLyricLayout(current => {
                if (current === "normal") {
                    return "compact";
                }
                return "hidden";
            });
        }
    }, [containerHeight, operationsBottom, orientation]);

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
            const coverSize = Math.min(availableWidth, comfortableHeight);
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
        if (typeof artwork === "string" && artwork.trim().length > 0) {
            showPanel("ImageViewer", {
                url: artwork,
            });
        }
    }, [artwork]);

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
                            style={[artworkStyle, coverAnimatedStyle]}
                        >
                            <FastImage
                                style={styles.coverImage}
                                source={artwork}
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

    return (
        <View
            style={styles.verticalRoot}
            onLayout={event => {
                setContainerHeight(event.nativeEvent.layout.height);
            }}>
            <Pressable
                delayLongPress={500}
                onPress={handlePress}
                onLongPress={handleLongPress}
                style={styles.coverArea}>
                <View style={styles.coverCenter}>
                    <Animated.View
                        style={[artworkStyle, coverAnimatedStyle]}
                    >
                        <FastImage
                            style={styles.coverImage}
                            source={artwork}
                            placeholderSource={ImgAsset.albumDefault}
                            transition={260}
                        />
                    </Animated.View>
                </View>
            </Pressable>
            {immersiveMode ? null : <SongInfo />}
            {miniLyricLayout === "hidden" ? null : (
                <MiniLyric
                    compact={miniLyricLayout === "compact"}
                    onPress={onTurnPageClick}
                />
            )}
            <View style={globalStyle.flex1} />
            <View
                onLayout={event => {
                    const layout = event.nativeEvent.layout;
                    setOperationsBottom(layout.y + layout.height);
                }}>
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
    coverArea: {
        width: "100%" as const,
        flex: 1,
        minHeight: rpx(360),
        justifyContent: "center" as const,
    },
    coverCenter: {
        width: "100%" as const,
        justifyContent: "center" as const,
        alignItems: "center" as const,
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
