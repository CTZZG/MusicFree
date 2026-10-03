import React, { useCallback, useEffect, useMemo, useRef } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import {
    LayoutChangeEvent,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
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
import {
    fitMusicDetailCardCover,
    getMusicDetailCardLayout,
    getMusicDetailCircleLyricLayout,
} from "../../../circleLayout";
import { useMusicDetailLayout } from "../../../layoutContext";
import { useI18N } from "@/core/i18n";

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
    const { t } = useI18N();
    // 横屏时左半边放封面和歌名，右半边是歌词
    const horizontalInfoWidth = Math.max(rpx(280), windowWidth / 2 - 48);

    const usableWindowHeight =
        windowHeight - safeAreaInsets.top - safeAreaInsets.bottom;
    // 封面按实际量到的空间收紧，歌名、迷你歌词才不会压到下面的进度条
    const { measured, reportContentHeight, reportSongInfoHeight } =
        useMusicDetailLayout();
    const rotation = useSharedValue(0);
    const isCircleCover = coverStyle === "circle";
    const isHeroCover = coverStyle === "hero";
    const shouldRotateCover = isCircleCover && !musicIsPaused(musicState);
    const heroLayout = useMemo(
        () =>
            getMusicDetailHeroLayout({
                windowWidth,
                windowHeight,
                safeAreaTop: safeAreaInsets.top,
                safeAreaBottom: safeAreaInsets.bottom,
                contentHeight: measured.contentHeight,
                songInfoHeight: measured.songInfoHeight.hero,
            }),
        [
            measured.contentHeight,
            measured.songInfoHeight.hero,
            safeAreaInsets.bottom,
            safeAreaInsets.top,
            windowHeight,
            windowWidth,
        ],
    );
    const cardLayout = useMemo(
        () =>
            getMusicDetailCardLayout(
                {
                    windowWidth,
                    windowHeight,
                    safeAreaTop: safeAreaInsets.top,
                    safeAreaBottom: safeAreaInsets.bottom,
                },
                isCircleCover ? "circle" : "square",
            ),
        [
            isCircleCover,
            safeAreaInsets.bottom,
            safeAreaInsets.top,
            windowHeight,
            windowWidth,
        ],
    );
    const cardFit = useMemo(() => {
        const lyricLayout = getMusicDetailCircleLyricLayout({
            windowWidth,
            windowHeight,
        });
        return fitMusicDetailCardCover({
            windowWidth,
            preferredCoverSize: cardLayout.coverSize,
            topSpace: cardLayout.navHeight + cardLayout.topGap,
            coverAreaExtra: cardLayout.coverAreaExtra,
            miniLyricHeight: lyricLayout.containerHeight + lyricLayout.marginTop,
            contentHeight: measured.contentHeight,
            songInfoHeight: measured.songInfoHeight.card,
        });
    }, [
        cardLayout,
        measured.contentHeight,
        measured.songInfoHeight.card,
        windowHeight,
        windowWidth,
    ]);

    const onContentLayout = useCallback(
        (event: LayoutChangeEvent) => {
            reportContentHeight(event.nativeEvent.layout.height);
        },
        [reportContentHeight],
    );
    const onCardSongInfoLayout = useCallback(
        (event: LayoutChangeEvent) => {
            reportSongInfoHeight("card", event.nativeEvent.layout.height);
        },
        [reportSongInfoHeight],
    );
    const onHeroSongInfoLayout = useCallback(
        (event: LayoutChangeEvent) => {
            reportSongInfoHeight("hero", event.nativeEvent.layout.height);
        },
        [reportSongInfoHeight],
    );

    const artworkStyle = useMemo(() => {
        // 圆形唱片；方形用 iOS 的圆角卡片，带一点投影
        const shapeStyle = isCircleCover
            ? styles.circleArtwork
            : styles.squareArtwork;
        const coverSize =
            orientation === "vertical"
                ? cardFit.coverSize
                : Math.min(rpx(300), usableWindowHeight * 0.4);
        return [shapeStyle, { width: coverSize, height: coverSize }];
    }, [cardFit.coverSize, isCircleCover, orientation, usableWindowHeight]);

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
                {immersiveMode ? null : <SongInfo width={horizontalInfoWidth} />}
            </View>
        );
    }

    if (isHeroCover) {
        return (
            <View
                style={[styles.verticalRoot, styles.heroVerticalRoot]}
                onLayout={onContentLayout}>
                <Pressable
                    delayLongPress={500}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    style={[styles.heroTapArea, { height: heroLayout.tapHeight }]}
                />
                {heroLayout.showMiniLyric ? (
                    <MiniLyric variant="hero" onPress={onTurnPageClick} />
                ) : null}
                <View onLayout={onHeroSongInfoLayout}>
                    <SongInfo variant="hero" />
                </View>
            </View>
        );
    }

    return (
        <View
            onLayout={onContentLayout}
            style={[
                styles.cardVerticalRoot,
                {
                    paddingTop: cardLayout.navHeight + cardLayout.topGap,
                },
            ]}>
            <Pressable
                delayLongPress={500}
                onPress={handlePress}
                onLongPress={handleLongPress}
                accessibilityRole="button"
                accessibilityHint={t("musicDetail.showLyric.a11y")}
                style={[
                    styles.coverArea,
                    { height: cardFit.coverSize + cardLayout.coverAreaExtra },
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
            <View style={styles.cardSongInfo} onLayout={onCardSongInfoLayout}>
                <SongInfo
                    width={isCircleCover ? undefined : cardFit.coverSize}
                />
            </View>
            {cardFit.showMiniLyric ? (
                <MiniLyric
                    variant="circle"
                    width={isCircleCover ? undefined : cardFit.coverSize}
                    onPress={onTurnPageClick}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    verticalRoot: {
        width: "100%",
        flex: 1,
    },
    heroVerticalRoot: {
        paddingBottom: rpx(64),
    },
    cardVerticalRoot: {
        width: "100%",
        flex: 1,
    },
    coverArea: {
        width: "100%",
        flexShrink: 0,
        justifyContent: "center",
    },
    coverCenter: {
        width: "100%",
        justifyContent: "center",
        alignItems: "center",
    },
    heroTapArea: {
        width: "100%",
        flexShrink: 0,
    },
    cardSongInfo: {
        flexShrink: 0,
    },
    coverImage: {
        width: "100%",
        height: "100%",
    },
    circleArtwork: {
        borderRadius: 9999,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255, 255, 255, 0.28)",
    },
    squareArtwork: {
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        elevation: 16,
        shadowColor: "#000000",
        shadowOpacity: 0.45,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 24 },
    },
    horizontalRoot: {
        width: "100%",
        flex: 1,
        justifyContent: "center",
    },
    horizontalCoverArea: {
        width: "100%",
        flex: 1,
        justifyContent: "center",
    },
});
