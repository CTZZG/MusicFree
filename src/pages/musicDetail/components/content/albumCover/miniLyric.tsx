import React, { useMemo } from "react";
import {
    Platform,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, {
    interpolate,
    interpolateColor,
    useAnimatedStyle,
} from "react-native-reanimated";
import MaskedView from "@react-native-masked-view/masked-view";
import LinearGradient from "react-native-linear-gradient";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
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

interface IMiniLyricDisplayLine {
    key: string;
    text: string;
    type: "context" | "current";
    item: IParsedLrcItem;
    nextItem?: IParsedLrcItem;
}

function getLyricText(item?: IParsedLrcItem | null) {
    return item?.lrc?.trim() ?? "";
}

function findNonEmptyLyricIndex(
    lyrics: IParsedLrcItem[],
    startIndex: number,
    step: number,
) {
    for (
        let index = startIndex;
        index >= 0 && index < lyrics.length;
        index += step
    ) {
        if (getLyricText(lyrics[index])) {
            return index;
        }
    }
    return -1;
}

const MIN_WORD_DURATION = 50;

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
        space: index === chars.length - 1 ? word.space : false,
    }));
}

function shouldAppendSpace(word: ILyric.IWordData) {
    return !!word.space && !word.text.endsWith(" ");
}

function MiniAnimatedWord(props: {
    word: ILyric.IWordData;
    fontSize: number;
    lineHeight: number;
}) {
    const { word, fontSize, lineHeight } = props;
    const currentPositionMs = useMemo(() => getCurrentPositionMsShared(), []);
    const maxTranslateY = Math.min(rpx(4), fontSize * 0.1);
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
        const wave = Math.sin(progress * Math.PI);

        return {
            color: interpolateColor(
                progress,
                [0, 1],
                ["rgba(255, 255, 255, 0.30)", "rgba(255, 255, 255, 1)"],
            ),
            opacity: interpolate(progress, [0, 0.3, 1], [0.42, 0.86, 1]),
            transform: [
                {
                    translateY: -wave * maxTranslateY,
                },
                {
                    scale: 1 + wave * 0.035,
                },
            ],
        };
    }, [maxTranslateY, wordDuration, wordStartTime]);

    return (
        <Animated.Text
            style={[
                styles.currentWord,
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

function MiniAnimatedWordGroup(props: {
    word: ILyric.IWordData;
    fontSize: number;
    lineHeight: number;
}) {
    const { word, fontSize, lineHeight } = props;
    const characters = useMemo(() => splitWordToChars(word), [word]);
    const trailingSpace = shouldAppendSpace(word) ? " " : "";

    return (
        <View style={styles.currentWordGroup}>
            {characters.map((character, index) => (
                <MiniAnimatedWord
                    key={`${character.startTime}-${index}`}
                    word={character}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                />
            ))}
            {trailingSpace ? (
                <Text
                    style={[
                        styles.currentWord,
                        {
                            color: "rgba(255, 255, 255, 0.30)",
                            fontSize,
                            lineHeight,
                        },
                    ]}>
                    {trailingSpace}
                </Text>
            ) : null}
        </View>
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
    const words = lyricWordData.words;
    const fontSize = compact ? fontSizeConst.subTitle : fontSizeConst.title;
    const lineHeight = compact ? rpx(38) : rpx(44);
    const maxHeight = compact ? lineHeight : lineHeight * 2;

    if (!lyricWordData.hasWordByWord || !words.length || !item.lrc.trim()) {
        return (
            <Text
                numberOfLines={compact ? 1 : 2}
                style={[
                    styles.primary,
                    compact ? styles.compactPrimary : styles.currentLine,
                ]}>
                {getLyricText(item)}
            </Text>
        );
    }

    return (
        <View
            style={[
                styles.currentWordLine,
                {
                    maxHeight,
                },
            ]}>
            {words.map((word, index) => (
                <MiniAnimatedWordGroup
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
    const { t } = useI18N();
    const lyricState = useLyricState();
    const currentLyricItem = useCurrentLyricItem();
    const { width: windowWidth } = useWindowDimensions();
    const infoWidth = useMemo(
        () => getSongInfoWidth(windowWidth),
        [windowWidth],
    );

    const displayState = useMemo(() => {
        if (lyricState.loading) {
            return {
                fallback: t("common.loading"),
                lines: [] as IMiniLyricDisplayLine[],
            };
        }
        if (!lyricState.lyrics.length) {
            return {
                fallback: t("lyric.noLyric"),
                lines: [] as IMiniLyricDisplayLine[],
            };
        }

        const currentIndex = Math.max(
            0,
            Math.min(
                currentLyricItem?.index ?? 0,
                lyricState.lyrics.length - 1,
            ),
        );
        const previousActiveIndex = findNonEmptyLyricIndex(
            lyricState.lyrics,
            currentIndex - 1,
            -1,
        );
        const nextActiveIndex = findNonEmptyLyricIndex(
            lyricState.lyrics,
            currentIndex + 1,
            1,
        );
        const activeIndex = getLyricText(lyricState.lyrics[currentIndex])
            ? currentIndex
            : previousActiveIndex >= 0
                ? previousActiveIndex
                : nextActiveIndex;
        const normalizedActiveIndex =
            activeIndex >= 0 ? activeIndex : currentIndex;
        const nonEmptyIndices = lyricState.lyrics
            .map((item, index) => (getLyricText(item) ? index : -1))
            .filter(index => index >= 0);
        if (nonEmptyIndices.length === 0) {
            return {
                fallback: t("lyric.noLyric"),
                lines: [] as IMiniLyricDisplayLine[],
            };
        }
        const activePosition = nonEmptyIndices.indexOf(normalizedActiveIndex);
        const windowCenter =
            activePosition >= 0
                ? activePosition
                : Math.max(0, nonEmptyIndices.length - 1);
        let startIndex = Math.max(0, windowCenter - 2);
        const endIndex = Math.min(nonEmptyIndices.length, startIndex + 5);
        startIndex = Math.max(0, endIndex - 5);

        const lines: IMiniLyricDisplayLine[] = nonEmptyIndices
            .slice(startIndex, endIndex)
            .map(index => ({
                key: `lyric-${index}`,
                text: getLyricText(lyricState.lyrics[index]),
                type: index === normalizedActiveIndex ? "current" : "context",
                item: lyricState.lyrics[index],
                nextItem: lyricState.lyrics[index + 1],
            }));

        return {
            fallback: "",
            lines,
        };
    }, [
        currentLyricItem?.index,
        lyricState.loading,
        lyricState.lyrics,
        t,
    ]);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                { width: infoWidth },
                compact ? styles.compactContainer : null,
                pressed ? styles.pressed : null,
            ]}>
            <View style={[styles.inner, compact ? styles.compactInner : null]}>
                {compact || displayState.fallback ? (
                    displayState.fallback ? (
                        <Text
                            numberOfLines={compact ? 1 : 2}
                            style={[
                                styles.primary,
                                compact ? styles.compactPrimary : null,
                            ]}>
                            {displayState.fallback}
                        </Text>
                    ) : (
                        <MiniWordByWordLine
                            compact={compact}
                            item={
                                displayState.lines.find(
                                    line => line.type === "current",
                                )!.item
                            }
                            nextItem={
                                displayState.lines.find(
                                    line => line.type === "current",
                                )!.nextItem
                            }
                        />
                    )
                ) : (
                    <View style={styles.stackShell}>
                        <MaskedView
                            style={styles.maskedStack}
                            androidRenderingMode={
                                Platform.OS === "android"
                                    ? "software"
                                    : undefined
                            }
                            maskElement={
                                <View style={styles.maskContainer}>
                                    <LinearGradient
                                        colors={[
                                            "rgba(0,0,0,0)",
                                            "rgba(0,0,0,1)",
                                        ]}
                                        style={styles.maskFade}
                                    />
                                    <View style={styles.maskBody} />
                                    <LinearGradient
                                        colors={[
                                            "rgba(0,0,0,1)",
                                            "rgba(0,0,0,0)",
                                        ]}
                                        style={styles.maskFade}
                                    />
                                </View>
                            }>
                            <View style={styles.stack}>
                                {displayState.lines.map(line =>
                                    line.type === "current" ? (
                                        <MiniWordByWordLine
                                            key={line.key}
                                            item={line.item}
                                            nextItem={line.nextItem}
                                        />
                                    ) : (
                                        <Text
                                            key={line.key}
                                            numberOfLines={1}
                                            style={[
                                                styles.stackLine,
                                                styles.contextLine,
                                            ]}>
                                            {line.text}
                                        </Text>
                                    ),
                                )}
                            </View>
                        </MaskedView>
                        <LinearGradient
                            pointerEvents="none"
                            colors={[
                                "rgba(255,255,255,0.10)",
                                "rgba(255,255,255,0)",
                            ]}
                            style={styles.topSheen}
                        />
                        <LinearGradient
                            pointerEvents="none"
                            colors={[
                                "rgba(0,0,0,0)",
                                "rgba(0,0,0,0.20)",
                            ]}
                            style={styles.bottomShade}
                        />
                    </View>
                )}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "center",
        marginTop: rpx(2),
        marginBottom: rpx(10),
    },
    compactContainer: {
        marginBottom: rpx(4),
    },
    inner: {
        width: "100%",
        minHeight: rpx(190),
        justifyContent: "center",
        alignItems: "flex-start",
    },
    compactInner: {
        minHeight: rpx(52),
    },
    primary: {
        width: "100%",
        color: "white",
        fontSize: fontSizeConst.content,
        fontWeight: fontWeightConst.medium,
        includeFontPadding: false,
        lineHeight: rpx(40),
        textAlign: "left",
    },
    compactPrimary: {
        fontSize: fontSizeConst.subTitle,
    },
    stack: {
        width: "100%",
        justifyContent: "center",
    },
    stackShell: {
        position: "relative",
        width: "100%",
        minHeight: rpx(190),
        justifyContent: "center",
        overflow: "hidden",
    },
    maskedStack: {
        width: "100%",
        height: rpx(190),
        justifyContent: "center",
    },
    maskContainer: {
        flex: 1,
        width: "100%",
    },
    maskFade: {
        height: rpx(46),
    },
    maskBody: {
        flex: 1,
        backgroundColor: "black",
    },
    topSheen: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: rpx(50),
    },
    bottomShade: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: rpx(58),
    },
    stackLine: {
        width: "100%",
        includeFontPadding: false,
        textAlign: "left",
    },
    currentLine: {
        color: "white",
        fontSize: fontSizeConst.title,
        fontWeight: fontWeightConst.bold,
        lineHeight: rpx(44),
        textShadowColor: "rgba(255, 255, 255, 0.32)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(8),
    },
    currentWordLine: {
        width: "100%",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
        overflow: "hidden",
        paddingVertical: rpx(1),
    },
    currentWordGroup: {
        flexDirection: "row",
        alignItems: "baseline",
    },
    currentWord: {
        includeFontPadding: false,
        fontWeight: fontWeightConst.bold,
        textShadowColor: "rgba(255, 255, 255, 0.28)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(7),
    },
    contextLine: {
        color: "rgba(255, 255, 255, 0.30)",
        fontSize: fontSizeConst.content,
        lineHeight: rpx(38),
        marginVertical: rpx(3),
        textShadowColor: "rgba(255, 255, 255, 0.12)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(5),
    },
    pressed: {
        opacity: 0.65,
    },
});
