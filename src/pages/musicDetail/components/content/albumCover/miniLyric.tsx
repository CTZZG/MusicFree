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
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import {
    getCurrentPositionMsShared,
    useCurrentLyricItem,
    useLyricState,
} from "@/core/lyricManager";
import rpx from "@/utils/rpx";
import { getSongInfoWidth } from "./songInfo";
import type { IParsedLrcItem } from "@/utils/lrcParser";
import { getLyricWordData } from "@/utils/lyricWordByWord";

interface IMiniLyricProps {
    compact?: boolean;
    onPress?: () => void;
}

const LINE_HEIGHT = rpx(42);
const COMPACT_LINE_HEIGHT = rpx(36);
const GROUP_SPACING = rpx(8);
const CONTAINER_HEIGHT = rpx(222);
const COMPACT_CONTAINER_HEIGHT = rpx(72);
const FADE_HEIGHT = rpx(58);
const COMPACT_FADE_HEIGHT = rpx(22);
const MIN_WORD_DURATION = 50;

function getLyricText(item?: IParsedLrcItem | null) {
    return item?.lrc?.trim() ?? "";
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

function shouldAppendSpace(word: ILyric.IWordData) {
    return !!word.space && !word.text.endsWith(" ");
}

function flattenWordsToCharacters(words: ILyric.IWordData[]) {
    return words.flatMap(word => {
        const chars = splitWordToChars(word);
        if (!shouldAppendSpace(word)) {
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
    fontSize: number;
    lineHeight: number;
}) {
    const { word, fontSize, lineHeight } = props;
    const currentPositionMs = useMemo(() => getCurrentPositionMsShared(), []);
    const wordStartTime = word.startTime;
    const wordDuration = word.duration;
    const animatedStyle = useAnimatedStyle(() => {
        const startTime = wordStartTime;
        const duration = Math.max(wordDuration || 0, MIN_WORD_DURATION);
        const endTime = startTime + duration;
        const currentTime = currentPositionMs.value;
        const progress =
            currentTime <= startTime
                ? 0
                : currentTime >= endTime
                  ? 1
                  : (currentTime - startTime) / duration;

        return {
            color: interpolateColor(
                progress,
                [0, 1],
                ["rgba(255, 255, 255, 0.38)", "rgba(255, 255, 255, 1)"],
            ),
            opacity: interpolate(progress, [0, 0.3, 1], [0.55, 0.88, 1]),
            textShadowRadius: interpolate(progress, [0, 1], [0, rpx(8)]),
        };
    }, [wordDuration, wordStartTime]);

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
    nextItem?: IParsedLrcItem;
    compact?: boolean;
}) {
    const { item, nextItem, compact } = props;
    const lyricWordData = useMemo(
        () => getLyricWordData(item, "original", nextItem),
        [item, nextItem],
    );
    const characters = useMemo(
        () => flattenWordsToCharacters(lyricWordData.words),
        [lyricWordData.words],
    );
    const fontSize = compact ? fontSizeConst.subTitle : fontSizeConst.title;
    const lineHeight = compact ? COMPACT_LINE_HEIGHT : LINE_HEIGHT;

    if (!lyricWordData.hasWordByWord || !characters.length) {
        return (
            <Text
                numberOfLines={1}
                style={[
                    styles.activeLine,
                    {
                        fontSize,
                        height: lineHeight,
                        lineHeight,
                    },
                ]}>
                {getLyricText(item)}
            </Text>
        );
    }

    return (
        <View
            style={[
                styles.activeWordLine,
                {
                    height: lineHeight,
                },
            ]}>
            {characters.map((word, index) => (
                <MiniAnimatedCharacter
                    key={`${word.startTime}-${index}`}
                    word={word}
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

    const lyrics = lyricState.lyrics;
    const currentIndex = Math.max(
        0,
        Math.min(currentLyricItem?.index ?? 0, Math.max(0, lyrics.length - 1)),
    );
    const containerHeight = compact ? COMPACT_CONTAINER_HEIGHT : CONTAINER_HEIGHT;
    const lineHeight = compact ? COMPACT_LINE_HEIGHT : LINE_HEIGHT;
    const groupHeight = lineHeight + GROUP_SPACING;
    const fadeHeight = compact ? COMPACT_FADE_HEIGHT : FADE_HEIGHT;

    useEffect(() => {
        if (lyrics.length === 0) {
            return;
        }

        const targetY =
            -currentIndex * groupHeight + (containerHeight - groupHeight) / 2;

        if (lastIndexRef.current === -1) {
            translateY.value = targetY;
        } else if (lastIndexRef.current !== currentIndex) {
            translateY.value = withTiming(targetY, {
                duration: 420,
                easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            });
        }
        lastIndexRef.current = currentIndex;
    }, [containerHeight, currentIndex, groupHeight, lyrics.length, translateY]);

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

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                {
                    width: infoWidth,
                    height: containerHeight,
                    marginTop: compact ? rpx(10) : rpx(22),
                },
                pressed ? styles.pressed : null,
            ]}>
            <MaskedView
                style={styles.maskedView}
                androidRenderingMode={
                    Platform.OS === "android" ? "software" : undefined
                }
                maskElement={maskElement}>
                <View style={styles.contentContainer}>
                    <Animated.View
                        style={[styles.lyricsWrapper, animatedListStyle]}>
                        {lyrics.map((item, index) => {
                            const isActive = index === currentIndex;
                            const text = getLyricText(item);
                            const distance = Math.abs(index - currentIndex);
                            const opacity =
                                distance === 0
                                    ? 1
                                    : distance === 1
                                      ? 0.48
                                      : distance === 2
                                        ? 0.28
                                        : 0.16;

                            return (
                                <View
                                    key={`${item.time}-${index}`}
                                    style={[
                                        styles.lyricGroup,
                                        {
                                            height: groupHeight,
                                            opacity,
                                        },
                                    ]}>
                                    {isActive ? (
                                        <MiniWordByWordLine
                                            item={item}
                                            nextItem={lyrics[index + 1]}
                                            compact={compact}
                                        />
                                    ) : text ? (
                                        <Text
                                            numberOfLines={1}
                                            style={[
                                                styles.contextLine,
                                                {
                                                    height: lineHeight,
                                                    lineHeight,
                                                },
                                            ]}>
                                            {text}
                                        </Text>
                                    ) : (
                                        <View
                                            style={{
                                                height: lineHeight,
                                            }}
                                        />
                                    )}
                                </View>
                            );
                        })}
                    </Animated.View>
                </View>
            </MaskedView>
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
        color: "white",
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
        textAlign: "left",
        textShadowColor: "rgba(255, 255, 255, 0.28)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(9),
    },
    activeCharacter: {
        color: "white",
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
        textShadowColor: "rgba(255, 255, 255, 0.32)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
    },
    activeWordLine: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    contextLine: {
        width: "100%",
        color: "white",
        fontSize: fontSizeConst.content,
        fontWeight: fontWeightConst.medium,
        includeFontPadding: false,
        textAlign: "left",
        textShadowColor: "rgba(255, 255, 255, 0.12)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(5),
    },
    pressed: {
        opacity: 0.72,
    },
});
