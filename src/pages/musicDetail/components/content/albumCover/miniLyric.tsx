import React, { useMemo } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import { useCurrentLyricItem, useLyricState } from "@/core/lyricManager";
import rpx from "@/utils/rpx";
import { getSongInfoWidth } from "./songInfo";
import type { IParsedLrcItem } from "@/utils/lrcParser";

interface IMiniLyricProps {
    compact?: boolean;
    onPress?: () => void;
}

interface IMiniLyricDisplayLine {
    key: string;
    text: string;
    type: "context" | "current";
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
                    <Text
                        numberOfLines={compact ? 1 : 2}
                        style={[
                            styles.primary,
                            compact ? styles.compactPrimary : null,
                        ]}>
                        {displayState.fallback ||
                            displayState.lines.find(
                                line => line.type === "current",
                            )?.text}
                    </Text>
                ) : (
                    <View style={styles.stack}>
                        {displayState.lines.map(line => (
                            <Text
                                key={line.key}
                                numberOfLines={line.type === "current" ? 2 : 1}
                                style={[
                                    styles.stackLine,
                                    line.type === "current"
                                        ? styles.currentLine
                                        : null,
                                    line.type === "context"
                                        ? styles.contextLine
                                        : null,
                                ]}>
                                {line.text}
                            </Text>
                        ))}
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
    contextLine: {
        color: "rgba(255, 255, 255, 0.36)",
        fontSize: fontSizeConst.content,
        lineHeight: rpx(38),
        marginVertical: rpx(3),
    },
    pressed: {
        opacity: 0.65,
    },
});
