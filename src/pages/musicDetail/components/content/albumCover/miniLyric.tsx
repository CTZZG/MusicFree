import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import { useCurrentLyricItem, useLyricState } from "@/core/lyricManager";
import PersistStatus from "@/utils/persistStatus";
import rpx from "@/utils/rpx";
import { getCoverLeftMargin } from "./index";
import type { IParsedLrcItem } from "@/utils/lrcParser";

interface IMiniLyricProps {
    compact?: boolean;
    onPress?: () => void;
}

interface IMiniLyricDisplayLine {
    key: string;
    text: string;
    type: "context" | "current" | "secondary";
}

function getLyricText(item?: IParsedLrcItem | null) {
    return item?.lrc?.trim() ?? "";
}

function getSecondaryLyricText(
    item: IParsedLrcItem | undefined,
    showTranslation: boolean,
    showRomanization: boolean,
) {
    if (showTranslation && item?.translation?.trim()) {
        return item.translation.trim();
    }
    if (showRomanization && item?.romanization?.trim()) {
        return item.romanization.trim();
    }
    return "";
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
    const showTranslation = PersistStatus.useValue(
        "lyric.showTranslation",
        false,
    );
    const showRomanization = PersistStatus.useValue(
        "lyric.showRomanization",
        false,
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
        const activeItem = lyricState.lyrics[normalizedActiveIndex];
        const activeText = getLyricText(activeItem) || " ";
        const previousIndex = findNonEmptyLyricIndex(
            lyricState.lyrics,
            normalizedActiveIndex - 1,
            -1,
        );
        const nextIndex = findNonEmptyLyricIndex(
            lyricState.lyrics,
            normalizedActiveIndex + 1,
            1,
        );
        const secondaryText = getSecondaryLyricText(
            activeItem,
            !!showTranslation,
            !!showRomanization,
        );
        const lines: IMiniLyricDisplayLine[] = [];

        if (previousIndex >= 0) {
            lines.push({
                key: `previous-${previousIndex}`,
                text: getLyricText(lyricState.lyrics[previousIndex]),
                type: "context",
            });
        }
        lines.push({
            key: `current-${normalizedActiveIndex}`,
            text: activeText,
            type: "current",
        });
        if (secondaryText) {
            lines.push({
                key: `secondary-${normalizedActiveIndex}`,
                text: secondaryText,
                type: "secondary",
            });
        }
        if (nextIndex >= 0) {
            lines.push({
                key: `next-${nextIndex}`,
                text: getLyricText(lyricState.lyrics[nextIndex]),
                type: "context",
            });
        }

        return {
            fallback: "",
            lines,
        };
    }, [
        currentLyricItem?.index,
        lyricState.loading,
        lyricState.lyrics,
        showRomanization,
        showTranslation,
        t,
    ]);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                compact ? styles.compactContainer : null,
                pressed ? styles.pressed : null,
            ]}>
            <View style={styles.inner}>
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
                                    line.type === "secondary"
                                        ? styles.secondaryLine
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
        width: "100%",
        paddingHorizontal: getCoverLeftMargin(),
        marginTop: rpx(2),
        marginBottom: rpx(10),
    },
    compactContainer: {
        marginBottom: rpx(4),
    },
    inner: {
        width: "100%",
        minHeight: rpx(132),
        justifyContent: "center",
        alignItems: "flex-start",
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
        fontSize: fontSizeConst.content,
        fontWeight: fontWeightConst.bold,
        lineHeight: rpx(38),
        textShadowColor: "rgba(255, 255, 255, 0.32)",
        textShadowOffset: {
            width: 0,
            height: 0,
        },
        textShadowRadius: rpx(8),
    },
    secondaryLine: {
        color: "rgba(255, 255, 255, 0.58)",
        fontSize: fontSizeConst.description,
        lineHeight: rpx(30),
        marginTop: rpx(6),
    },
    contextLine: {
        color: "rgba(255, 255, 255, 0.34)",
        fontSize: fontSizeConst.description,
        lineHeight: rpx(34),
        marginVertical: rpx(4),
    },
    pressed: {
        opacity: 0.65,
    },
});
