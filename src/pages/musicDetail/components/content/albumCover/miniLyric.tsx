import React, { useEffect, useMemo, useRef } from "react";
import {
    Platform,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, {
    Easing,
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import MaskedView from "@react-native-masked-view/masked-view";
import LinearGradient from "react-native-linear-gradient";
import { useAppConfig } from "@/core/appConfig";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import {
    getCurrentPositionMsShared,
    useCurrentLyricItem,
    useLyricState,
} from "@/core/lyricManager";
import PersistStatus from "@/utils/persistStatus";
import rpx from "@/utils/rpx";
import { getSongInfoWidth } from "./songInfo";
import type { IParsedLrcItem } from "@/utils/lrcParser";
import {
    getLyricWordData,
    type LyricWordLineType,
} from "@/utils/lyricWordByWord";
import { BreathingDots } from "../lyric/lyricItem";

interface IMiniLyricProps {
    compact?: boolean;
    onPress?: () => void;
}

type MiniLyricLineType = LyricWordLineType;

const PRIMARY_LINE_HEIGHT = rpx(40);
const SECONDARY_LINE_HEIGHT = rpx(28);
const COMPACT_LINE_HEIGHT = rpx(36);
const GROUP_SPACING = rpx(8);
const CONTAINER_HEIGHT = rpx(198);
const COMPACT_CONTAINER_HEIGHT = rpx(96);
const FADE_HEIGHT = rpx(56);
const COMPACT_FADE_HEIGHT = rpx(26);
const MIN_WORD_DURATION = 50;

const defaultMiniLyricOrder: MiniLyricLineType[] = [
    "original",
    "translation",
    "romanization",
];

function normalizeMiniLyricOrder(order?: MiniLyricLineType[]) {
    const displayOrder: MiniLyricLineType[] = [];
    [...(order ?? []), ...defaultMiniLyricOrder].forEach(type => {
        if (!displayOrder.includes(type)) {
            displayOrder.push(type);
        }
    });
    return displayOrder;
}

function getLineText(item: IParsedLrcItem, type: MiniLyricLineType) {
    if (type === "translation") {
        return item.translation ?? "";
    }
    if (type === "romanization") {
        return item.romanization ?? "";
    }
    return item.lrc ?? "";
}

function splitWordToChars(word: ILyric.IWordData) {
    const text = word.text ?? "";
    const chars = Array.from(text);

    if (chars.length <= 1 || /^\s+$/.test(text)) {
        return [word];
    }

    const duration = Math.max(word.duration || 0, MIN_WORD_DURATION);
    const charDuration = duration / chars.length;

    return chars.map((char, index) => ({
        text: char,
        startTime: word.startTime + charDuration * index,
        duration: charDuration,
        space: false,
    }));
}

function flattenWordsToCharacters(words: ILyric.IWordData[]) {
    return words.flatMap(word => {
        const chars = splitWordToChars(word);
        const shouldAppendSpace = !!word.space && !word.text.endsWith(" ");
        if (!shouldAppendSpace) {
            return chars;
        }
        return [
            ...chars,
            {
                text: " ",
                startTime: word.startTime + Math.max(word.duration || 0, 0),
                duration: MIN_WORD_DURATION,
                space: false,
            },
        ];
    });
}

function MiniAnimatedCharacter(props: {
    word: ILyric.IWordData;
    activeColor: string;
    inactiveColor: string;
    fontSize: number;
    lineHeight: number;
}) {
    const { word, activeColor, inactiveColor, fontSize, lineHeight } = props;
    const currentPositionMs = useMemo(() => getCurrentPositionMsShared(), []);
    const wordStartTime = word.startTime;
    const wordDuration = word.duration;
    const animatedStyle = useAnimatedStyle(() => {
        const duration = Math.max(wordDuration || 0, MIN_WORD_DURATION);
        const endTime = wordStartTime + duration;
        const currentTime = currentPositionMs.value;
        const progress =
            currentTime <= wordStartTime
                ? 0
                : currentTime >= endTime
                  ? 1
                  : (currentTime - wordStartTime) / duration;
        const wave = Math.sin(progress * Math.PI);

        return {
            color: interpolateColor(
                progress,
                [0, 1],
                [inactiveColor, activeColor],
            ),
            opacity: interpolate(progress, [0, 0.35, 1], [0.52, 0.86, 1]),
            textShadowRadius: interpolate(progress, [0, 1], [0, rpx(9)]),
            transform: [
                {
                    translateY: -wave * rpx(3),
                },
                {
                    scale: 1 + wave * 0.04,
                },
            ],
        };
    }, [activeColor, inactiveColor, wordDuration, wordStartTime]);

    return (
        <Animated.Text
            style={[
                styles.activeCharacter,
                {
                    fontSize,
                    lineHeight,
                },
                animatedStyle,
            ]}>
            {word.text}
        </Animated.Text>
    );
}

function MiniWordByWordLine(props: {
    item: IParsedLrcItem;
    type: MiniLyricLineType;
    nextItem?: IParsedLrcItem;
    activeColor: string;
    inactiveColor: string;
    fontSize: number;
    lineHeight: number;
    enableWordByWord: boolean;
}) {
    const {
        item,
        type,
        nextItem,
        activeColor,
        inactiveColor,
        fontSize,
        lineHeight,
        enableWordByWord,
    } = props;
    const text = getLineText(item, type);
    const lyricWordData = useMemo(
        () => getLyricWordData(item, type, nextItem, enableWordByWord),
        [enableWordByWord, item, nextItem, type],
    );
    const characters = useMemo(
        () => flattenWordsToCharacters(lyricWordData.words),
        [lyricWordData.words],
    );

    if (!enableWordByWord || !lyricWordData.hasWordByWord || !characters.length) {
        return (
            <Text
                numberOfLines={1}
                style={[
                    styles.activeLine,
                    {
                        color: activeColor,
                        fontSize,
                        height: lineHeight,
                        lineHeight,
                    },
                ]}>
                {text}
            </Text>
        );
    }

    return (
        <View
            style={[
                styles.activeWordLine,
                {
                    minHeight: lineHeight,
                },
            ]}>
            {characters.map((word, index) => (
                <MiniAnimatedCharacter
                    key={`${word.startTime}-${index}`}
                    word={word}
                    activeColor={activeColor}
                    inactiveColor={inactiveColor}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                />
            ))}
        </View>
    );
}

export default function MiniLyric(props: IMiniLyricProps) {
    const { compact = false, onPress } = props;
    const lyricState = useLyricState();
    const currentLyricItem = useCurrentLyricItem();
    const { width: windowWidth } = useWindowDimensions();
    const infoWidth = useMemo(
        () => getSongInfoWidth(windowWidth),
        [windowWidth],
    );
    const translateY = useSharedValue(0);
    const lastIndexRef = useRef(-1);
    const enableWordByWord = useAppConfig("lyric.enableWordByWord") ?? true;
    const pureWhiteMode = useAppConfig("lyric.pureWhiteMode") ?? true;
    const enableBreathingDots =
        useAppConfig("lyric.enableBreathingDots") ?? true;
    const configuredLyricOrder = useAppConfig("basic.lyricOrder");
    const lyricOrder = useMemo(
        () => normalizeMiniLyricOrder(configuredLyricOrder),
        [configuredLyricOrder],
    );
    const showTranslation = PersistStatus.useValue(
        "lyric.showTranslation",
        false,
    );
    const showRomanization = PersistStatus.useValue(
        "lyric.showRomanization",
        false,
    );

    const lyrics = lyricState.lyrics;
    const currentIndex = Math.max(
        0,
        Math.min(currentLyricItem?.index ?? 0, Math.max(0, lyrics.length - 1)),
    );
    const containerHeight = compact ? COMPACT_CONTAINER_HEIGHT : CONTAINER_HEIGHT;
    const fadeHeight = compact ? COMPACT_FADE_HEIGHT : FADE_HEIGHT;
    const activeColor = pureWhiteMode ? "white" : "rgba(126, 229, 255, 1)";
    const inactiveColor = "rgba(255, 255, 255, 0.36)";

    const visibleTypes = useMemo(() => {
        if (compact) {
            return ["original"] as MiniLyricLineType[];
        }
        return lyricOrder.filter(type => {
            if (type === "original") {
                return true;
            }
            if (type === "translation") {
                return !!showTranslation && lyricState.hasTranslation;
            }
            if (type === "romanization") {
                return !!showRomanization && lyricState.hasRomanization;
            }
            return false;
        });
    }, [
        compact,
        lyricOrder,
        lyricState.hasRomanization,
        lyricState.hasTranslation,
        showRomanization,
        showTranslation,
    ]);

    const groupHeights = useMemo(
        () =>
            lyrics.map(item => {
                const hasText = visibleTypes.some(type =>
                    getLineText(item, type).trim(),
                );
                if (!hasText) {
                    return (compact ? COMPACT_LINE_HEIGHT : PRIMARY_LINE_HEIGHT) +
                        GROUP_SPACING;
                }
                const lineCount = Math.max(1, visibleTypes.length);
                if (compact) {
                    return COMPACT_LINE_HEIGHT + GROUP_SPACING;
                }
                return (
                    PRIMARY_LINE_HEIGHT +
                    Math.max(0, lineCount - 1) * SECONDARY_LINE_HEIGHT +
                    GROUP_SPACING
                );
            }),
        [compact, lyrics, visibleTypes],
    );

    useEffect(() => {
        if (lyrics.length === 0) {
            return;
        }

        const beforeHeight = groupHeights
            .slice(0, currentIndex)
            .reduce((sum, height) => sum + height, 0);
        const currentGroupHeight =
            groupHeights[currentIndex] ??
            (compact ? COMPACT_LINE_HEIGHT : PRIMARY_LINE_HEIGHT);
        const targetY =
            -beforeHeight + (containerHeight - currentGroupHeight) / 2;

        if (lastIndexRef.current === -1) {
            translateY.value = targetY;
        } else if (lastIndexRef.current !== currentIndex) {
            translateY.value = withTiming(targetY, {
                duration: 420,
                easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            });
        }
        lastIndexRef.current = currentIndex;
    }, [
        compact,
        containerHeight,
        currentIndex,
        groupHeights,
        lyrics.length,
        translateY,
    ]);

    const animatedListStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateY: translateY.value,
            },
        ],
    }));

    const maskElement = useMemo(
        () => (
            <View style={styles.maskContainer}>
                <LinearGradient
                    colors={["rgba(0,0,0,0)", "rgba(0,0,0,1)"]}
                    style={{ height: fadeHeight }}
                />
                <View style={styles.maskBody} />
                <LinearGradient
                    colors={["rgba(0,0,0,1)", "rgba(0,0,0,0)"]}
                    style={{ height: fadeHeight }}
                />
            </View>
        ),
        [fadeHeight],
    );

    if (lyricState.loading || lyrics.length === 0) {
        return null;
    }

    const lyricContent = (
        <View style={styles.contentContainer}>
            <Animated.View style={[styles.lyricsWrapper, animatedListStyle]}>
                {lyrics.map((item, index) => {
                    const isActive = index === currentIndex;
                    const distance = Math.abs(index - currentIndex);
                    const opacity =
                        distance === 0
                            ? 1
                            : distance === 1
                              ? 0.5
                              : distance === 2
                                ? 0.28
                                : 0.12;
                    const hasText = visibleTypes.some(type =>
                        getLineText(item, type).trim(),
                    );

                    return (
                        <View
                            key={`${item.time}-${index}`}
                            style={[
                                styles.lyricGroup,
                                {
                                    minHeight: groupHeights[index],
                                    opacity,
                                },
                            ]}>
                            {!hasText ? (
                                isActive && enableBreathingDots ? (
                                    <View style={styles.dotsLine}>
                                        <BreathingDots
                                            color={activeColor}
                                            align="left"
                                            highlight
                                        />
                                    </View>
                                ) : (
                                    <View style={styles.dotsLine} />
                                )
                            ) : (
                                visibleTypes.map((type, typeIndex) => {
                                    const text = getLineText(item, type);
                                    if (!text.trim() && type !== "original") {
                                        return null;
                                    }
                                    const isPrimary = typeIndex === 0;
                                    const fontSize = compact
                                        ? fontSizeConst.subTitle
                                        : isPrimary
                                          ? fontSizeConst.title
                                          : fontSizeConst.content;
                                    const lineHeight = compact
                                        ? COMPACT_LINE_HEIGHT
                                        : isPrimary
                                          ? PRIMARY_LINE_HEIGHT
                                          : SECONDARY_LINE_HEIGHT;
                                    if (isActive && isPrimary) {
                                        return (
                                            <MiniWordByWordLine
                                                key={type}
                                                item={item}
                                                type={type}
                                                nextItem={lyrics[index + 1]}
                                                activeColor={activeColor}
                                                inactiveColor={inactiveColor}
                                                fontSize={fontSize}
                                                lineHeight={lineHeight}
                                                enableWordByWord={
                                                    enableWordByWord
                                                }
                                            />
                                        );
                                    }
                                    return (
                                        <Text
                                            key={type}
                                            numberOfLines={1}
                                            style={[
                                                isPrimary
                                                    ? styles.contextPrimaryLine
                                                    : styles.contextSecondaryLine,
                                                {
                                                    color: isActive
                                                        ? activeColor
                                                        : "white",
                                                    fontSize,
                                                    height: lineHeight,
                                                    lineHeight,
                                                },
                                            ]}>
                                            {text}
                                        </Text>
                                    );
                                })
                            )}
                        </View>
                    );
                })}
            </Animated.View>
        </View>
    );

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                {
                    width: infoWidth,
                    height: containerHeight,
                    marginTop: compact ? rpx(8) : rpx(16),
                },
                pressed ? styles.pressed : null,
            ]}>
            {Platform.OS === "android" ? (
                <>
                    {lyricContent}
                    <LinearGradient
                        pointerEvents="none"
                        colors={[
                            "rgba(0,0,0,0.4)",
                            "rgba(0,0,0,0)",
                        ]}
                        style={[styles.androidFade, styles.androidFadeTop, {
                            height: fadeHeight,
                        }]}
                    />
                    <LinearGradient
                        pointerEvents="none"
                        colors={[
                            "rgba(0,0,0,0)",
                            "rgba(0,0,0,0.4)",
                        ]}
                        style={[styles.androidFade, styles.androidFadeBottom, {
                            height: fadeHeight,
                        }]}
                    />
                </>
            ) : (
                <MaskedView style={styles.maskedView} maskElement={maskElement}>
                    {lyricContent}
                </MaskedView>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    maskedView: {
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "transparent",
    },
    maskContainer: {
        flex: 1,
        width: "100%",
    },
    maskBody: {
        flex: 1,
        backgroundColor: "black",
    },
    contentContainer: {
        width: "100%",
        height: "100%",
        overflow: "hidden",
    },
    lyricsWrapper: {
        width: "100%",
    },
    lyricGroup: {
        width: "100%",
        justifyContent: "center",
    },
    activeLine: {
        width: "100%",
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
        textAlign: "left",
        textShadowColor: "rgba(255, 255, 255, 0.38)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(10),
    },
    activeCharacter: {
        color: "white",
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
        textShadowColor: "rgba(255, 255, 255, 0.38)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
    },
    activeWordLine: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        overflow: "hidden",
    },
    contextPrimaryLine: {
        width: "100%",
        color: "white",
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
        textAlign: "left",
        textShadowColor: "rgba(255, 255, 255, 0.14)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(5),
    },
    contextSecondaryLine: {
        width: "100%",
        color: "white",
        fontWeight: fontWeightConst.medium,
        includeFontPadding: false,
        opacity: 0.72,
        textAlign: "left",
    },
    dotsLine: {
        minHeight: PRIMARY_LINE_HEIGHT,
        justifyContent: "center",
    },
    androidFade: {
        position: "absolute",
        left: 0,
        right: 0,
        zIndex: 2,
    },
    androidFadeTop: {
        top: 0,
    },
    androidFadeBottom: {
        bottom: 0,
    },
    pressed: {
        opacity: 0.72,
    },
});
