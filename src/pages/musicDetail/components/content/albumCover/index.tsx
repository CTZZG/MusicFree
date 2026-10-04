import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import {
    LayoutChangeEvent,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import { showPanel } from "@/components/panels/usePanel.ts";
import SongInfo, { getSongInfoWidth } from "./songInfo";
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
    getMusicDetailLandscapeLayout,
} from "../../../circleLayout";
import { useMusicDetailLayout } from "../../../layoutContext";
import { useI18N } from "@/core/i18n";

export const COVER_SIZE = rpx(500);
export const COVER_MARGIN = (rpx(750) - COVER_SIZE) / 2;

// 封面每次挂载（比如从歌词页切回来）都要重新解码图片，哪怕命中缓存也要几帧。
// 这几帧里先不显示封面容器，图片画出来后再淡入；网络慢、迟迟画不出来时，
// 到点先把占位卡片淡入，图片到了再叠上去
const COVER_REVEAL_MS = 160;
const COVER_REVEAL_FALLBACK_MS = 500;
const ARTWORK_TRANSITION_MS = 260;

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
    const {
        height: windowHeight,
        width: windowWidth,
        fontScale,
    } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const longPressTriggeredRef = useRef(false);
    const { t } = useI18N();
    // 横屏时左半边放封面和歌名（并排），右半边是歌词；尺寸按实际量到的区域定
    const [landscapeArea, setLandscapeArea] = useState<{
        width: number;
        height: number;
    } | null>(null);

    const usableWindowHeight =
        windowHeight - safeAreaInsets.top - safeAreaInsets.bottom;
    // 封面按实际量到的空间收紧，歌名、迷你歌词才不会压到下面的进度条
    const { measured, reportContentHeight, reportSongInfoHeight } =
        useMusicDetailLayout();
    const rotation = useSharedValue(0);
    const coverOpacity = useSharedValue(0);
    const coverRevealedRef = useRef(false);
    const [coverRevealed, setCoverRevealed] = useState(false);
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

    // 方形卡片的歌名和迷你歌词与封面同宽、两边对齐；封面缩得很小时（小屏、
    // 大字体）不再跟着缩，否则歌名只剩两三个字的宽度
    const cardInfoWidth = isCircleCover
        ? undefined
        : Math.max(cardFit.coverSize, getSongInfoWidth(windowWidth));

    const landscapeLayout = useMemo(
        () =>
            getMusicDetailLandscapeLayout({
                // 量到之前按左半边、可用高度的三分之一估一个，第一帧之后就换成实测
                width: landscapeArea?.width ?? windowWidth / 2,
                height: landscapeArea?.height ?? usableWindowHeight / 3,
                showSongInfo: !immersiveMode,
                fontScale,
            }),
        [
            fontScale,
            immersiveMode,
            landscapeArea,
            usableWindowHeight,
            windowWidth,
        ],
    );
    const onLandscapeLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setLandscapeArea(previous =>
            previous &&
            Math.abs(previous.width - width) < 0.5 &&
            Math.abs(previous.height - height) < 0.5
                ? previous
                : { width, height },
        );
    }, []);

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
                : landscapeLayout.coverSize;
        return [shapeStyle, { width: coverSize, height: coverSize }];
    }, [
        cardFit.coverSize,
        isCircleCover,
        landscapeLayout.coverSize,
        orientation,
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
        opacity: coverOpacity.value,
        transform: [
            {
                rotate: `${rotation.value}deg`,
            },
        ],
    }));

    const revealCover = useCallback(() => {
        if (coverRevealedRef.current) {
            return;
        }
        coverRevealedRef.current = true;
        setCoverRevealed(true);
        coverOpacity.value = withTiming(1, { duration: COVER_REVEAL_MS });
    }, [coverOpacity]);

    useEffect(() => {
        const timer = setTimeout(revealCover, COVER_REVEAL_FALLBACK_MS);
        return () => clearTimeout(timer);
    }, [revealCover]);

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
            <View
                style={[
                    styles.horizontalRoot,
                    {
                        paddingHorizontal: landscapeLayout.gap,
                        gap: landscapeLayout.gap,
                    },
                ]}
                onLayout={onLandscapeLayout}>
                {landscapeLayout.coverSize > 0 ? (
                    <Pressable
                        delayLongPress={500}
                        onPress={handlePress}
                        onLongPress={handleLongPress}
                        style={styles.horizontalCoverArea}>
                        <Animated.View
                            style={[artworkStyle, coverAnimatedStyle]}>
                            <FastImage
                                style={styles.coverImage}
                                source={displayArtwork}
                                placeholderSource={ImgAsset.albumDefault}
                                // 第一次直接画上，由外层淡入；之后换歌再交叉淡入
                                transition={
                                    coverRevealed ? ARTWORK_TRANSITION_MS : 0
                                }
                                onDisplay={revealCover}
                            />
                        </Animated.View>
                    </Pressable>
                ) : null}
                {landscapeLayout.songInfo ? (
                    // 行数已按量到的高度算好；万一系统字体的度量和预算对不上，
                    // 宁可裁掉也不压到进度条上
                    <View style={styles.horizontalSongInfo}>
                        <SongInfo
                            variant="landscape"
                            width={landscapeLayout.infoWidth}
                            landscapeFit={landscapeLayout.songInfo}
                        />
                    </View>
                ) : null}
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
                            transition={
                                coverRevealed ? ARTWORK_TRANSITION_MS : 0
                            }
                            onDisplay={revealCover}
                        />
                    </Animated.View>
                </View>
            </Pressable>
            <View style={styles.cardSongInfo} onLayout={onCardSongInfoLayout}>
                <SongInfo width={cardInfoWidth} />
            </View>
            {cardFit.showMiniLyric ? (
                <MiniLyric
                    variant="circle"
                    width={cardInfoWidth}
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
        // 必须不透明：半透明底色下，Android 会透出自身的投影，图片没画出来时
        // 就是一大一小两个方框
        backgroundColor: "#2C2C2E",
        elevation: 16,
        shadowColor: "#000000",
        shadowOpacity: 0.45,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 24 },
    },
    horizontalRoot: {
        width: "100%",
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    horizontalCoverArea: {
        flexShrink: 0,
    },
    horizontalSongInfo: {
        maxHeight: "100%",
        overflow: "hidden",
    },
});
