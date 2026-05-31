import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import Animated, {
    interpolate,
    interpolateColor,
    useAnimatedStyle,
} from "react-native-reanimated";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { getCurrentPositionMsShared } from "@/core/lyricManager";
import { normalizeLyricWords } from "@/utils/lyricWordByWord";

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

    onLayout?: (index: number, height: number) => void;
}

const MIN_WORD_DURATION = 50;
const ACTIVE_FLOAT_RATE = 0.12;
const ACTIVE_SCALE_RATE = 0.05;

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
}) {
    const {
        word,
        activeColor,
        inactiveColor,
        fontSize,
        lineHeight,
        primary,
        isPseudo,
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
                        primary && !isPseudo
                            ? -wave * maxTranslateY
                            : 0,
                },
                {
                    scale:
                        primary && !isPseudo
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
}) {
    const {
        word,
        activeColor,
        inactiveColor,
        fontSize,
        lineHeight,
        primary,
        isPseudo,
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

function _LyricItemComponent(props: ILyricItemComponentProps) {
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
    } = props;

    const colors = useColors();
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

    return (
        <View
            onLayout={({ nativeEvent }) => {
                if (index !== undefined) {
                    onLayout?.(index, nativeEvent.layout.height);
                }
            }}
            style={[
                lyricStyles.item,
                highlight
                    ? [
                        lyricStyles.highlightItem,
                    ]
                    : null,
                light ? lyricStyles.draggingItem : null,
            ]}>
            {displayLines.map(line => {
                const currentFontSize = line.primary
                    ? primaryFontSize
                    : primaryFontSize * secondaryFontScale;
                const lineHeight = Math.round(
                    currentFontSize * (line.primary ? 1.34 : 1.28),
                );
                const canUseWordByWord =
                    !!line.hasWordByWord &&
                    !!line.words?.length &&
                    !!line.text.trim() &&
                    (highlight || !line.isPseudoWordByWord);

                return (
                    <View
                        key={line.key}
                        style={[
                            lyricStyles.lineWrapper,
                            line.primary ? null : lyricStyles.secondaryLine,
                        ]}>
                        {canUseWordByWord ? (
                            <WordByWordLine
                                line={line}
                                activeColor={colors.primary}
                                inactiveColor="rgba(255, 255, 255, 0.48)"
                                staticColor="white"
                                fontSize={currentFontSize}
                                lineHeight={lineHeight}
                                textAlign={textAlign}
                                highlight={highlight}
                            />
                        ) : (
                            <Text
                                style={[
                                    lyricStyles.line,
                                    line.primary ? lyricStyles.primaryLine : null,
                                    {
                                        color: highlight
                                            ? colors.primary
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
        </View>
    );
}

// 歌词
const LyricItemComponent = memo(
    _LyricItemComponent,
    (prev, curr) =>
        prev.light === curr.light &&
        prev.highlight === curr.highlight &&
        prev.text === curr.text &&
        prev.lines === curr.lines &&
        prev.index === curr.index &&
        prev.fontSize === curr.fontSize &&
        prev.secondaryFontScale === curr.secondaryFontScale &&
        prev.textAlign === curr.textAlign,
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
});
