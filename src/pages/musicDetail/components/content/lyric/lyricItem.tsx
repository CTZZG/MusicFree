import React, { memo, useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import Animated, {
    Easing,
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { getCurrentPositionMsShared } from "@/core/lyricManager";
import {
    canAnimateLyricWords,
    normalizeLyricWords,
} from "@/utils/lyricWordByWord";
import { useAppConfig } from "@/core/appConfig";

interface ILyricLine {
    key: string;
    text: string;
    primary: boolean;
    hasWordByWord?: boolean;
    words?: ILyric.IWordData[];
    lineStartTimeMs?: number;
    isPseudoWordByWord?: boolean;
}

interface ILyricItemComponentProps {
    // 行号
    index?: number;
    // 显示
    light?: boolean;
    // 高亮
    highlight?: boolean;
    // 文本
    text?: string;
    // 多行歌词
    lines?: ILyricLine[];
    // 字体大小
    fontSize?: number;
    // 副行字号比例
    secondaryFontScale?: number;
    // 对齐方式
    textAlign?: NonNullable<TextStyle["textAlign"]>;
    // AMLL-lite 聚焦歌词布局
    amllLiteMode?: boolean;

    onLayout?: (index: number, height: number) => void;
    onPress?: () => void;
    onPressIn?: () => void;
}

const MIN_WORD_DURATION = 50;
const ACTIVE_FLOAT_RATE = 0.12;
const ACTIVE_SCALE_RATE = 0.05;
const DOT_SIZE = rpx(12);
const DOT_GAP = rpx(10);

export const BreathingDots = memo(function BreathingDots(props: {
    color: string;
    align?: "left" | "center" | "right";
    highlight?: boolean;
}) {
    const { color, align = "center", highlight = false } = props;
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = withRepeat(
            withTiming(1, {
                duration: 1800,
                easing: Easing.inOut(Easing.ease),
            }),
            -1,
            true,
        );
    }, [progress]);

    const dotStyle0 = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.5, 1], [0.35, 1, 0.35]),
        transform: [
            {
                scale: interpolate(
                    progress.value,
                    [0, 0.5, 1],
                    [0.88, highlight ? 1.18 : 1.04, 0.88],
                ),
            },
        ],
    }));
    const dotStyle1 = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.5, 1], [0.55, 0.35, 1]),
        transform: [
            {
                scale: interpolate(
                    progress.value,
                    [0, 0.5, 1],
                    [1, 0.88, highlight ? 1.18 : 1.04],
                ),
            },
        ],
    }));
    const dotStyle2 = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.5, 1], [1, 0.55, 0.35]),
        transform: [
            {
                scale: interpolate(
                    progress.value,
                    [0, 0.5, 1],
                    [highlight ? 1.18 : 1.04, 1, 0.88],
                ),
            },
        ],
    }));

    return (
        <View
            style={[
                lyricStyles.dotsContainer,
                {
                    alignItems:
                        align === "left"
                            ? "flex-start"
                            : align === "right"
                                ? "flex-end"
                                : "center",
                },
            ]}>
            <View style={lyricStyles.dotsRow}>
                {[dotStyle0, dotStyle1, dotStyle2].map((animatedStyle, index) => (
                    <Animated.View
                        key={index}
                        style={[
                            lyricStyles.dot,
                            { backgroundColor: color },
                            animatedStyle,
                        ]}
                    />
                ))}
            </View>
        </View>
    );
});

function normalizeTextAlign(value: NonNullable<TextStyle["textAlign"]>) {
    if (value === "left" || value === "right" || value === "center") {
        return value;
    }
    return "center";
}

function getRowJustifyContent(value: NonNullable<TextStyle["textAlign"]>) {
    const textAlign = normalizeTextAlign(value);
    if (textAlign === "left") {
        return "flex-start" as const;
    }
    if (textAlign === "right") {
        return "flex-end" as const;
    }
    return "center" as const;
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
        space: index === chars.length - 1 ? word.space : false,
    }));
}

function shouldAppendSpace(word: ILyric.IWordData) {
    return !!word.space && !word.text.endsWith(" ");
}

function StaticWordGroup(props: {
    word: ILyric.IWordData;
    color: string;
    fontSize: number;
    lineHeight: number;
    primary: boolean;
}) {
    const { word, color, fontSize, lineHeight, primary } = props;
    const characters = useMemo(() => splitWordToChars(word), [word]);
    const trailingSpace = shouldAppendSpace(word) ? " " : "";

    if (characters.length === 1) {
        return (
            <Text
                style={[
                    lyricStyles.wordText,
                    primary ? lyricStyles.primaryWord : null,
                    {
                        color,
                        fontSize,
                        lineHeight,
                    },
                ]}>
                {characters[0].text}
                {trailingSpace}
            </Text>
        );
    }

    return (
        <View style={lyricStyles.charGroup}>
            {characters.map((character, index) => (
                <Text
                    key={`${character.startTime}-${index}`}
                    style={[
                        lyricStyles.wordText,
                        primary ? lyricStyles.primaryWord : null,
                        {
                            color,
                            fontSize,
                            lineHeight,
                        },
                    ]}>
                    {character.text}
                </Text>
            ))}
            {trailingSpace ? (
                <Text
                    style={[
                        lyricStyles.wordText,
                        {
                            color,
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

function AnimatedWord(props: {
    word: ILyric.IWordData;
    activeColor: string;
    inactiveColor: string;
    fontSize: number;
    lineHeight: number;
    primary: boolean;
    isPseudo?: boolean;
    enableFloat?: boolean;
}) {
    const {
        word,
        activeColor,
        inactiveColor,
        fontSize,
        lineHeight,
        primary,
        isPseudo,
        enableFloat,
    } = props;
    const currentPositionMs = useMemo(() => getCurrentPositionMsShared(), []);
    const maxTranslateY = Math.min(rpx(5), fontSize * ACTIVE_FLOAT_RATE);
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
                [inactiveColor, activeColor],
            ),
            opacity: interpolate(progress, [0, 0.35, 1], [0.55, 0.82, 1]),
            transform: [
                {
                    translateY:
                        primary && !isPseudo && enableFloat
                            ? -wave * maxTranslateY
                            : 0,
                },
                {
                    scale:
                        primary && !isPseudo && enableFloat
                            ? 1 + wave * ACTIVE_SCALE_RATE
                            : 1,
                },
            ],
        };
    }, [
        activeColor,
        inactiveColor,
        fontSize,
        isPseudo,
        maxTranslateY,
        primary,
        enableFloat,
        wordDuration,
        wordStartTime,
    ]);

    return (
        <Animated.Text
            style={[
                lyricStyles.wordText,
                primary ? lyricStyles.primaryWord : null,
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

function AnimatedWordGroup(props: {
    word: ILyric.IWordData;
    activeColor: string;
    inactiveColor: string;
    fontSize: number;
    lineHeight: number;
    primary: boolean;
    isPseudo?: boolean;
    enableFloat?: boolean;
}) {
    const {
        word,
        activeColor,
        inactiveColor,
        fontSize,
        lineHeight,
        primary,
        isPseudo,
        enableFloat,
    } = props;
    const characters = useMemo(() => splitWordToChars(word), [word]);
    const trailingSpace = shouldAppendSpace(word) ? " " : "";

    if (characters.length === 1) {
        return (
            <View style={lyricStyles.charGroup}>
                <AnimatedWord
                    word={characters[0]}
                    activeColor={activeColor}
                    inactiveColor={inactiveColor}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    primary={primary}
                    isPseudo={isPseudo}
                    enableFloat={enableFloat}
                />
                {trailingSpace ? (
                    <Text
                        style={[
                            lyricStyles.wordText,
                            {
                                color: inactiveColor,
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

    return (
        <View style={lyricStyles.charGroup}>
            {characters.map((character, index) => (
                <AnimatedWord
                    key={`${character.startTime}-${index}`}
                    word={character}
                    activeColor={activeColor}
                    inactiveColor={inactiveColor}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    primary={primary}
                    isPseudo={isPseudo}
                    enableFloat={enableFloat}
                />
            ))}
            {trailingSpace ? (
                <Text
                    style={[
                        lyricStyles.wordText,
                        {
                            color: inactiveColor,
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

function WordByWordLine(props: {
    line: ILyricLine;
    activeColor: string;
    inactiveColor: string;
    staticColor: string;
    fontSize: number;
    lineHeight: number;
    textAlign: NonNullable<TextStyle["textAlign"]>;
    highlight?: boolean;
    enableFloat?: boolean;
}) {
    const {
        line,
        activeColor,
        inactiveColor,
        staticColor,
        fontSize,
        lineHeight,
        textAlign,
        highlight,
        enableFloat,
    } = props;
    const words = useMemo(
        () => normalizeLyricWords(line.words ?? [], line.lineStartTimeMs ?? 0),
        [line.lineStartTimeMs, line.words],
    );
    const justifyContent = getRowJustifyContent(textAlign);

    return (
        <View
            style={[
                lyricStyles.wordLine,
                {
                    justifyContent,
                },
            ]}>
            {words.map((word, index) =>
                highlight ? (
                    <AnimatedWordGroup
                        key={`${word.startTime}-${index}`}
                        word={word}
                        activeColor={activeColor}
                        inactiveColor={inactiveColor}
                        fontSize={fontSize}
                        lineHeight={lineHeight}
                        primary={line.primary}
                        isPseudo={line.isPseudoWordByWord}
                        enableFloat={enableFloat}
                    />
                ) : (
                    <StaticWordGroup
                        key={`${word.startTime}-${index}`}
                        word={word}
                        color={staticColor}
                        fontSize={fontSize}
                        lineHeight={lineHeight}
                        primary={line.primary}
                    />
                ),
            )}
        </View>
    );
}

function LyricItemComponentInner(props: ILyricItemComponentProps) {
    const {
        light,
        highlight,
        text,
        lines,
        onLayout,
        index,
        fontSize,
        secondaryFontScale = 0.75,
        textAlign = "center",
        amllLiteMode = false,
        onPress,
        onPressIn,
    } = props;

    const colors = useColors();
    const enableWordByWord = useAppConfig("lyric.enableWordByWord") ?? true;
    const enableWordByWordFloat =
        useAppConfig("lyric.enableWordByWordFloat") ?? true;
    const pureWhiteMode = useAppConfig("lyric.pureWhiteMode") ?? true;
    const enableBreathingDots =
        useAppConfig("lyric.enableBreathingDots") ?? true;
    const activeColor = pureWhiteMode ? "white" : colors.primary;
    const displayLines = lines?.length
        ? lines
        : [
            {
                key: "text",
                text: text ?? "",
                primary: true,
            },
        ];
    const primaryFontSize = fontSize || fontSizeConst.content;
    const isAmlLiteFocused = amllLiteMode && highlight;
    const amllLiteItemScale = amllLiteMode
        ? isAmlLiteFocused
            ? 1.22
            : 0.88
        : 1;

    const itemStyle = [
        lyricStyles.item,
        amllLiteMode ? lyricStyles.amllLiteItem : null,
        highlight
            ? [
                lyricStyles.highlightItem,
            ]
            : null,
        amllLiteMode && !highlight
            ? lyricStyles.amllLiteInactiveItem
            : null,
        isAmlLiteFocused ? lyricStyles.amllLiteFocusedItem : null,
        light ? lyricStyles.draggingItem : null,
    ];
    const handleLayout = ({ nativeEvent }: any) => {
        if (index !== undefined) {
            onLayout?.(index, nativeEvent.layout.height);
        }
    };
    const content = (
        <>
            {displayLines.map(line => {
                const baseFontSize = line.primary
                    ? primaryFontSize
                    : primaryFontSize * secondaryFontScale;
                const currentFontSize = amllLiteMode
                    ? Math.round(
                        baseFontSize *
                            (line.primary
                                ? amllLiteItemScale
                                : amllLiteItemScale *
                                  (isAmlLiteFocused ? 1 : 0.96)),
                    )
                    : baseFontSize;
                const lineHeight = Math.round(
                    currentFontSize *
                        (amllLiteMode
                            ? line.primary
                                ? 1.42
                                : 1.34
                            : line.primary
                                ? 1.34
                                : 1.28),
                );
                const canUseWordByWord =
                    enableWordByWord &&
                    canAnimateLyricWords({
                        hasWordByWord: line.hasWordByWord,
                        words: line.words,
                        text: line.text,
                        isPseudoWordByWord: line.isPseudoWordByWord,
                    });
                const isEmptyLine = !line.text.trim();

                return (
                    <View
                        key={line.key}
                        style={[
                            lyricStyles.lineWrapper,
                            line.primary ? null : lyricStyles.secondaryLine,
                        ]}>
                        {isEmptyLine && highlight && enableBreathingDots ? (
                            <BreathingDots
                                color={activeColor}
                                align={normalizeTextAlign(textAlign)}
                                highlight
                            />
                        ) : canUseWordByWord ? (
                            <WordByWordLine
                                line={line}
                                activeColor={activeColor}
                                inactiveColor="rgba(255, 255, 255, 0.48)"
                                staticColor="white"
                                fontSize={currentFontSize}
                                lineHeight={lineHeight}
                                textAlign={textAlign}
                                highlight={highlight}
                                enableFloat={enableWordByWordFloat}
                            />
                        ) : (
                            <Text
                                style={[
                                    lyricStyles.line,
                                    line.primary ? lyricStyles.primaryLine : null,
                                    isAmlLiteFocused && line.primary
                                        ? lyricStyles.amllLiteFocusedLine
                                        : null,
                                    {
                                        color: highlight
                                            ? activeColor
                                            : "white",
                                        fontSize: currentFontSize,
                                        lineHeight,
                                        textAlign,
                                    },
                                ]}>
                                {line.text}
                            </Text>
                        )}
                    </View>
                );
            })}
        </>
    );

    if (onPress) {
        return (
            <Pressable
                onLayout={handleLayout}
                onPress={onPress}
                onPressIn={onPressIn}
                style={itemStyle}>
                {content}
            </Pressable>
        );
    }

    return (
        <View
            onLayout={handleLayout}
            style={itemStyle}>
            {content}
        </View>
    );
}

// 歌词
const LyricItemComponent = memo(
    LyricItemComponentInner,
    (prev, curr) =>
        prev.light === curr.light &&
        prev.highlight === curr.highlight &&
        prev.text === curr.text &&
        prev.lines === curr.lines &&
        prev.index === curr.index &&
        prev.fontSize === curr.fontSize &&
        prev.secondaryFontScale === curr.secondaryFontScale &&
        prev.textAlign === curr.textAlign &&
        prev.amllLiteMode === curr.amllLiteMode &&
        prev.onPress === curr.onPress &&
        prev.onPressIn === curr.onPressIn,
);

export default LyricItemComponent;

const lyricStyles = StyleSheet.create({
    highlightItem: {
        opacity: 1,
    },
    item: {
        opacity: 0.58,
        paddingHorizontal: rpx(64),
        paddingVertical: rpx(22),
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
    },
    amllLiteItem: {
        paddingHorizontal: rpx(38),
        paddingVertical: rpx(18),
        alignSelf: "stretch",
        borderRadius: rpx(24),
    },
    amllLiteInactiveItem: {
        opacity: 0.34,
    },
    amllLiteFocusedItem: {
        opacity: 1,
        backgroundColor: "rgba(255, 255, 255, 0.1)",
    },
    lineWrapper: {
        width: "100%",
    },
    line: {
        width: "100%",
        textAlignVertical: "center",
    },
    primaryLine: {
        fontWeight: fontWeightConst.bold,
    },
    amllLiteFocusedLine: {
        textShadowColor: "rgba(255, 255, 255, 0.22)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(6),
    },
    secondaryLine: {
        marginTop: rpx(6),
        opacity: 0.82,
    },
    draggingItem: {
        opacity: 0.9,
        color: "white",
    },
    wordLine: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
        width: "100%",
    },
    charGroup: {
        flexDirection: "row",
        alignItems: "baseline",
    },
    wordText: {
        includeFontPadding: false,
        textAlignVertical: "center",
    },
    primaryWord: {
        fontWeight: fontWeightConst.bold,
        textShadowColor: "rgba(255, 255, 255, 0.22)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(4),
    },
    dotsContainer: {
        width: "100%",
        minHeight: rpx(32),
        justifyContent: "center",
    },
    dotsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: DOT_GAP,
    },
    dot: {
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        shadowColor: "#fff",
        shadowOffset: {
            width: 0,
            height: 0,
        },
        shadowOpacity: 0.35,
        shadowRadius: rpx(6),
    },
});
