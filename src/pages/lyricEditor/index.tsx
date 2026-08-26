import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { nanoid } from "nanoid";

import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import IconButton from "@/components/base/iconButton";
import SortableFlashList from "@/components/base/sortableFlashList";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import { fontSizeConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import lyricManager, {
    getCurrentPositionMsShared,
    readLocalLyricRawText,
} from "@/core/lyricManager";
import { useParams } from "@/core/router";
import TrackPlayer, { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import { isSameMediaItem } from "@/utils/mediaUtils";
import { musicIsPaused } from "@/utils/trackUtils";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import {
    formatEditableLyricTime,
    IEditableLyricLine,
    insertLyricLine,
    nudgeLyricLineTime,
    parseEditableLyricTime,
    parseLyricForEditing,
    removeLyricLine,
    serializeLyricForEditing,
    updateLyricLineText,
    updateLyricLineTime,
} from "./lyricEditorPolicy";

const ROW_HEIGHT = rpx(112);
const NUDGE_MS = 100;

export default function LyricEditor() {
    const { musicItem } = useParams<"lyric-editor">();
    const { t } = useI18N();
    const colors = useColors();

    const [meta, setMeta] = useState<Record<string, string>>({});
    const [lines, setLines] = useState<IEditableLyricLine[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const isActiveTrack = !!(
        currentMusic && isSameMediaItem(currentMusic, musicItem)
    );
    const isPlaying = isActiveTrack && !musicIsPaused(musicState);

    useEffect(() => {
        let cancelled = false;
        readLocalLyricRawText(musicItem)
            .then(raw => {
                if (cancelled) {
                    return;
                }
                const parsed = parseLyricForEditing(raw, nanoid);
                setMeta(parsed.meta);
                setLines(parsed.lines);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled) {
                    setLoaded(true);
                }
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const clampActiveIndex = useCallback(
        (index: number, length: number) =>
            length === 0 ? 0 : Math.min(Math.max(index, 0), length - 1),
        [],
    );

    const handleTogglePlay = useCallback(() => {
        if (!isActiveTrack) {
            TrackPlayer.play(musicItem);
            return;
        }
        if (isPlaying) {
            TrackPlayer.pause();
        } else {
            TrackPlayer.play();
        }
    }, [isActiveTrack, isPlaying, musicItem]);

    const handleStamp = useCallback(() => {
        setLines(prev => {
            if (!prev.length) {
                return prev;
            }
            const index = clampActiveIndex(activeIndex, prev.length);
            const positionMs = getCurrentPositionMsShared().value;
            const next = updateLyricLineTime(
                prev,
                prev[index].id,
                positionMs,
            );
            setActiveIndex(clampActiveIndex(index + 1, next.length));
            return next;
        });
    }, [activeIndex, clampActiveIndex]);

    const handleAddLine = useCallback(() => {
        setLines(prev => {
            const lastMs = prev.length ? prev[prev.length - 1].timeMs : 0;
            const next = insertLyricLine(prev, prev.length, {
                id: nanoid(),
                timeMs: prev.length ? lastMs + 1000 : 0,
                text: "",
            });
            setActiveIndex(next.length - 1);
            return next;
        });
    }, []);

    const handleDeleteLine = useCallback(
        (id: string) => {
            setLines(prev => {
                const next = removeLyricLine(prev, id);
                setActiveIndex(current => clampActiveIndex(current, next.length));
                return next;
            });
        },
        [clampActiveIndex],
    );

    const handleChangeText = useCallback((id: string, text: string) => {
        setLines(prev => updateLyricLineText(prev, id, text));
    }, []);

    const handleCommitTime = useCallback(
        (id: string, text: string) => {
            const parsedMs = parseEditableLyricTime(text);
            if (parsedMs === null) {
                Toast.warn(t("lyricEditor.timeInputInvalid"));
                // 触发一次状态刷新以强制受控 key 重新挂载、还原为上次的合法值
                setLines(prev => prev.slice());
                return;
            }
            setLines(prev => updateLyricLineTime(prev, id, parsedMs));
        },
        [t],
    );

    const handleNudge = useCallback((id: string, deltaMs: number) => {
        setLines(prev => nudgeLyricLineTime(prev, id, deltaMs));
    }, []);

    const handleSortEnd = useCallback((next: IEditableLyricLine[]) => {
        setLines(next);
    }, []);

    const handleSave = useCallback(async () => {
        const serialized = serializeLyricForEditing({ meta, lines });
        try {
            await lyricManager.uploadLocalLyric(musicItem, serialized, "raw");
            Toast.success(t("toast.saveSuccess"));
        } catch (e: any) {
            Toast.warn(e?.message ?? t("toast.saveSuccess"));
        }
    }, [lines, meta, musicItem, t]);

    const keyExtractor = useCallback(
        (item: IEditableLyricLine) => item.id,
        [],
    );
    const getItemAccessibilityLabel = useCallback(
        (item: IEditableLyricLine, index: number) =>
            t("lyricEditor.progress.a11y", {
                current: index + 1,
                total: lines.length,
            }) +
            (item.text ? `, ${item.text}` : ""),
        [lines.length, t],
    );

    const renderItem = useCallback(
        ({ item, index }: { item: IEditableLyricLine; index: number }) => (
            <LyricEditorRow
                line={item}
                index={index}
                active={index === activeIndex}
                onFocus={() => setActiveIndex(index)}
                onChangeText={handleChangeText}
                onCommitTime={handleCommitTime}
                onNudge={handleNudge}
                onDelete={handleDeleteLine}
            />
        ),
        [activeIndex, handleChangeText, handleCommitTime, handleDeleteLine, handleNudge],
    );

    const progressText = useMemo(
        () =>
            lines.length
                ? t("lyricEditor.progress.a11y", {
                    current: clampActiveIndex(activeIndex, lines.length) + 1,
                    total: lines.length,
                })
                : "",
        [activeIndex, clampActiveIndex, lines.length, t],
    );

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <AppBar
                actions={[
                    {
                        icon: "save-outline",
                        accessibilityLabel: t("common.save"),
                        onPress: handleSave,
                    },
                ]}>
                {t("lyricEditor.title")}
            </AppBar>
            <View style={styles.toolbar}>
                <IconButton
                    name={isPlaying ? "pause" : "play"}
                    sizeType="normal"
                    onPress={handleTogglePlay}
                    accessibilityLabel={
                        isActiveTrack
                            ? isPlaying
                                ? t("musicDetail.playControl.pause.a11y")
                                : t("common.play")
                            : t("lyricEditor.play.a11y")
                    }
                />
                <IconButton
                    name="crosshair"
                    sizeType="normal"
                    color={
                        isActiveTrack && lines.length
                            ? colors.primary
                            : colors.textSecondary
                    }
                    onPress={isActiveTrack && lines.length ? handleStamp : undefined}
                    accessibilityLabel={
                        isActiveTrack
                            ? t("lyricEditor.stamp.a11y")
                            : t("lyricEditor.stamp.disabledHint.a11y")
                    }
                />
                <ThemeText fontColor="textSecondary" fontSize="description">
                    {progressText}
                </ThemeText>
                <View style={globalStyle.fwflex1} />
                <IconButton
                    name="plus"
                    sizeType="normal"
                    onPress={handleAddLine}
                    accessibilityLabel={t("lyricEditor.addLine")}
                />
            </View>
            {!loaded ? (
                <View style={globalStyle.fwflex1} />
            ) : lines.length ? (
                <SortableFlashList
                    data={lines}
                    estimatedItemSize={ROW_HEIGHT}
                    activeBackgroundColor={colors.placeholder}
                    keyExtractor={keyExtractor}
                    getItemAccessibilityLabel={getItemAccessibilityLabel}
                    renderItem={renderItem}
                    onSortEnd={handleSortEnd}
                />
            ) : (
                <Empty content={t("lyricEditor.emptyHint")} />
            )}
        </VerticalSafeAreaView>
    );
}

interface ILyricEditorRowProps {
    line: IEditableLyricLine;
    index: number;
    active: boolean;
    onFocus: () => void;
    onChangeText: (id: string, text: string) => void;
    onCommitTime: (id: string, text: string) => void;
    onNudge: (id: string, deltaMs: number) => void;
    onDelete: (id: string) => void;
}

function LyricEditorRow(props: ILyricEditorRowProps) {
    const { line, index, active, onFocus, onChangeText, onCommitTime, onNudge, onDelete } =
        props;
    const { t } = useI18N();
    const colors = useColors();
    const formattedTime = formatEditableLyricTime(line.timeMs);

    return (
        <View
            style={[
                styles.row,
                active ? { backgroundColor: colors.listActive } : null,
            ]}>
            <View style={[styles.timeChip, { backgroundColor: colors.placeholder }]}>
                <IconButton
                    name="minus"
                    sizeType="small"
                    onPress={() => onNudge(line.id, -NUDGE_MS)}
                    accessibilityLabel={`-${NUDGE_MS}ms`}
                />
                <TextInput
                    key={`${line.id}-${line.timeMs}`}
                    defaultValue={formattedTime}
                    style={[styles.timeInput, { color: colors.text }]}
                    accessibilityLabel={t("lyricEditor.editTime.a11y", {
                        time: formattedTime,
                    })}
                    onFocus={onFocus}
                    onEndEditing={event =>
                        onCommitTime(line.id, event.nativeEvent.text)
                    }
                />
                <IconButton
                    name="plus"
                    sizeType="small"
                    onPress={() => onNudge(line.id, NUDGE_MS)}
                    accessibilityLabel={`+${NUDGE_MS}ms`}
                />
            </View>
            <TextInput
                value={line.text}
                style={[
                    styles.textInput,
                    { color: colors.text, backgroundColor: colors.placeholder },
                ]}
                placeholder={t("lyricEditor.textInputPlaceholder")}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel={t("lyricEditor.textInput.a11y", {
                    index: index + 1,
                })}
                onFocus={onFocus}
                onChangeText={text => onChangeText(line.id, text)}
            />
            <IconButton
                name="trash-outline"
                sizeType="normal"
                onPress={() => onDelete(line.id)}
                accessibilityLabel={t("lyricEditor.deleteLine.a11y", {
                    text: line.text || formattedTime,
                })}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    toolbar: {
        width: "100%",
        height: rpx(96),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(20),
    },
    row: {
        width: "100%",
        height: ROW_HEIGHT,
        paddingLeft: rpx(16),
        // SortableFlashList 的拖拽手柄绝对定位在每一行的最右侧（约 right: 12rpx
        // 宽 74rpx），行内容如果铺到底会被手柄盖住——删除按钮之前就是被这样叠住
        // 的。这里在行内容右侧多留出比手柄区域更宽的间距，两者不再抢占同一块。
        paddingRight: rpx(108),
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(12),
    },
    timeChip: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: rpx(16),
        paddingHorizontal: rpx(4),
    },
    timeInput: {
        width: rpx(112),
        textAlign: "center",
        fontVariant: ["tabular-nums"],
        fontSize: fontSizeConst.description,
    },
    textInput: {
        flex: 1,
        height: rpx(76),
        borderRadius: rpx(16),
        paddingHorizontal: rpx(20),
    },
});
