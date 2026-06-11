import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutRectangle, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import useDelayFalsy from "@/hooks/useDelayFalsy";
import { FlatList, Gesture, GestureDetector, TapGestureHandler } from "react-native-gesture-handler";
import { fontSizeConst } from "@/constants/uiConst";
import Loading from "@/components/base/loading";
import globalStyle from "@/constants/globalStyle";
import { showPanel } from "@/components/panels/usePanel";
import TrackPlayer, { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import delay from "@/utils/delay";
import DraggingTime from "./draggingTime";
import LyricItemComponent from "./lyricItem";
import PersistStatus from "@/utils/persistStatus";
import LyricOperations from "./lyricOperations";
import { IParsedLrcItem } from "@/utils/lrcParser";
import { IconButtonWithGesture } from "@/components/base/iconButton.tsx";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import lyricManager, { useCurrentLyricItem, useLyricState } from "@/core/lyricManager";
import { useI18N } from "@/core/i18n";
import { useAppConfig } from "@/core/appConfig";
import { getLyricWordData } from "@/utils/lyricWordByWord";

const ITEM_HEIGHT = rpx(92);

type LyricLineType = "original" | "translation" | "romanization";

interface IDetailLyricLine {
    key: LyricLineType;
    text: string;
    primary: boolean;
    hasWordByWord?: boolean;
    words?: ILyric.IWordData[];
    lineStartTimeMs?: number;
    isPseudoWordByWord?: boolean;
}

interface IItemHeights {
    blankHeight?: number;
    [k: number]: number;
}

interface IProps {
    immersiveMode?: boolean;
    onTurnPageClick?: () => void;
}

const fontSizeMap = {
    0: rpx(24),
    1: rpx(30),
    2: rpx(36),
    3: rpx(42),
} as Record<number, number>;

const defaultDetailLyricOrder: LyricLineType[] = [
    "original",
    "translation",
    "romanization",
];

const detailAlignSet = new Set(["left", "center", "right"]);

function normalizeDetailAlign(value: unknown) {
    return detailAlignSet.has(value as string)
        ? (value as "left" | "center" | "right")
        : "center";
}

function normalizeDetailLyricOrder(order?: LyricLineType[]) {
    const displayOrder: LyricLineType[] = [];
    [...(order ?? []), ...defaultDetailLyricOrder].forEach(type => {
        if (!displayOrder.includes(type)) {
            displayOrder.push(type);
        }
    });
    return displayOrder;
}

function getLyricLineText(item: IParsedLrcItem, type: LyricLineType) {
    if (type === "original") {
        return item.lrc;
    }
    if (type === "translation") {
        return item.translation ?? "";
    }
    return item.romanization ?? "";
}

function getLyricLineWordData(
    item: IParsedLrcItem,
    type: LyricLineType,
    nextItem?: IParsedLrcItem,
) {
    const lyricWordData = getLyricWordData(item, type, nextItem);
    if (!lyricWordData.hasWordByWord) {
        return {
            lineStartTimeMs: lyricWordData.lineStartTimeMs,
        };
    }

    return lyricWordData;
}

function buildDetailLyricLines(
    item: IParsedLrcItem,
    order: LyricLineType[],
    showTranslation: boolean,
    hasTranslation: boolean,
    showRomanization: boolean,
    hasRomanization: boolean,
    nextItem?: IParsedLrcItem,
) {
    const enabled = {
        original: true,
        translation: showTranslation && hasTranslation,
        romanization: showRomanization && hasRomanization,
    } as Record<LyricLineType, boolean>;
    const orderedLines = order
        .filter(type => enabled[type])
        .map(type => ({
            key: type,
            text: getLyricLineText(item, type),
            ...getLyricLineWordData(item, type, nextItem),
        }))
        .filter(line => line.key === "original" || line.text.trim().length);

    if (!orderedLines.length) {
        orderedLines.push({
            key: "original",
            text: item.lrc,
            ...getLyricLineWordData(item, "original", nextItem),
        });
    }

    const hasOriginal = orderedLines.some(
        line => line.key === "original" && line.text.trim().length,
    );

    return orderedLines.map((line, index) => ({
        ...line,
        primary: line.key === "original" || (!hasOriginal && index === 0),
    })) as IDetailLyricLine[];
}

export default function Lyric(props: IProps) {
    const { immersiveMode = false, onTurnPageClick } = props;

    const {
        loading,
        meta,
        lyrics,
        hasTranslation,
        hasRomanization,
        source,
        emptyReason,
    } = useLyricState();
    const currentLrcItem = useCurrentLyricItem();
    const showTranslation = PersistStatus.useValue(
        "lyric.showTranslation",
        false,
    );
    const showRomanization = PersistStatus.useValue(
        "lyric.showRomanization",
        false,
    );
    const configuredLyricOrder = useAppConfig("basic.lyricOrder");
    const lyricOrder = useMemo(
        () => normalizeDetailLyricOrder(configuredLyricOrder),
        [configuredLyricOrder],
    );
    const secondaryFontScale =
        useAppConfig("lyric.detailSecondaryFontScale") ?? 0.75;
    const fontSizeKey = PersistStatus.useValue("lyric.detailFontSize", 1);
    const detailAlign = normalizeDetailAlign(
        PersistStatus.useValue("lyric.detailAlign", "center"),
    );
    const fontSizeStyle = useMemo(
        () => ({
            fontSize: fontSizeMap[fontSizeKey!],
        }),
        [fontSizeKey],
    );

    const [draggingIndex, setDraggingIndex, setDraggingIndexImmi] =
        useDelayFalsy<number | undefined>(undefined, 2000);
    const musicState = useMusicState();
    const { t } = useI18N();

    const [layout, setLayout] = useState<LayoutRectangle>();

    const listRef = useRef<FlatList<IParsedLrcItem> | null>(null);

    const currentMusicItem = useCurrentMusic();
    const associateMusicItem = getMediaExtraProperty(currentMusicItem, "associatedLrc");
    const lyricSourceText = useMemo(() => {
        if (!source || source.type === "none" || associateMusicItem) {
            return null;
        }
        const pluginName = source.pluginName || currentMusicItem?.platform || "";
        const title = source.title || currentMusicItem?.title || "";
        switch (source.type) {
            case "plugin":
                return t("lyric.source.plugin", { plugin: pluginName });
            case "local":
                return t("lyric.source.local");
            case "cache":
                return t("lyric.source.cache", { plugin: pluginName });
            case "auto-search":
                return t("lyric.source.autoSearch", {
                    plugin: pluginName,
                    title,
                });
            case "associated":
                return t("lyric.lyricLinkedFrom", {
                    platform: pluginName,
                    title,
                });
            default:
                return null;
        }
    }, [associateMusicItem, currentMusicItem, source, t]);
    const noLyricReasonText = useMemo(() => {
        switch (emptyReason) {
            case "no-current-music":
                return t("lyric.noLyricReason.noCurrentMusic");
            case "plugin-not-found":
                return t("lyric.noLyricReason.pluginNotFound");
            case "plugin-not-supported":
                return t("lyric.noLyricReason.pluginNotSupported");
            case "plugin-empty":
                return t("lyric.noLyricReason.pluginEmpty");
            case "auto-search-empty":
                return t("lyric.noLyricReason.autoSearchEmpty");
            case "parse-failed":
                return t("lyric.noLyricReason.parseFailed");
            case "timeout":
                return t("lyric.noLyricReason.timeout");
            case "unknown":
                return t("lyric.noLyricReason.unknown");
            default:
                return null;
        }
    }, [emptyReason, t]);

    // 是否展示拖拽
    const dragShownRef = useRef(false);

    // 组件是否挂载
    const isMountedRef = useRef(true);

    // 用来缓存高度
    const itemHeightsRef = useRef<IItemHeights>({});

    // 设置空白组件，获取组件高度
    const blankComponent = useMemo(() => {
        return (
            <View
                style={styles.empty}
                onLayout={evt => {
                    itemHeightsRef.current.blankHeight =
                        evt.nativeEvent.layout.height;
                }}
            />
        );
    }, []);

    const handleLyricItemLayout = useCallback(
        (index: number, height: number) => {
            itemHeightsRef.current[index] = height;
        },
        [],
    );

    // 滚到当前item
    const scrollToCurrentLrcItem = useCallback(() => {
        if (!listRef.current) {
            return;
        }
        const currentLyricItem = lyricManager.currentLyricItem;
        const currentLyrics = lyricManager.lyricState?.lyrics;
        if (currentLyricItem?.index === -1 || !currentLyricItem) {
            listRef.current?.scrollToIndex({
                index: 0,
                viewPosition: 0.5,
            });
        } else {
            listRef.current?.scrollToIndex({
                index: Math.min(currentLyricItem.index ?? 0, currentLyrics.length - 1),
                viewPosition: 0.5,
            });
        }
    }, []);

    const delayedScrollToCurrentLrcItem = useMemo(() => {
        let sto: number;

        return () => {
            if (sto) {
                clearTimeout(sto);
            }
            sto = setTimeout(() => {
                if (isMountedRef.current) {
                    scrollToCurrentLrcItem();
                }
            }, 200) as any;
        };
    }, []);

    useEffect(() => {
        // 暂停且拖拽才返回
        if (
            lyrics.length === 0 ||
            draggingIndex !== undefined ||
            (draggingIndex === undefined && musicIsPaused(musicState)) ||
            lyrics[lyrics.length - 1].time < 1
        ) {
            return;
        }
        if (currentLrcItem?.index === -1 || !currentLrcItem) {
            listRef.current?.scrollToIndex({
                index: 0,
                viewPosition: 0.5,
            });
        } else {
            listRef.current?.scrollToIndex({
                index: Math.min(currentLrcItem.index ?? 0, lyrics.length - 1),
                viewPosition: 0.5,
            });
        }
        // 音乐暂停状态不应该影响到滑动，所以不放在依赖里，但是这样写不好。。
    }, [currentLrcItem, lyrics, draggingIndex]);

    useEffect(() => {
        scrollToCurrentLrcItem();
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // 开始滚动时拖拽生效
    const onScrollBeginDrag = () => {
        dragShownRef.current = true;
    };

    const onScrollEndDrag = async () => {
        if (draggingIndex !== undefined) {
            setDraggingIndex(undefined);
        }
        dragShownRef.current = false;
    };

    const onScroll = (e: any) => {
        if (dragShownRef.current) {
            const offset =
                e.nativeEvent.contentOffset.y +
                e.nativeEvent.layoutMeasurement.height / 2;

            const itemHeights = itemHeightsRef.current;
            let height = itemHeights.blankHeight!;
            if (offset <= height) {
                setDraggingIndex(0);
                return;
            }
            for (let i = 0; i < lyrics.length; ++i) {
                height += itemHeights[i] ?? 0;
                if (height > offset) {
                    setDraggingIndex(i);
                    return;
                }
            }
        }
    };

    const onLyricSeekPress = async () => {
        if (draggingIndex !== undefined) {
            const time = lyrics[draggingIndex].time + +(meta?.offset ?? 0);
            if (time !== undefined && !isNaN(time)) {
                await TrackPlayer.seekTo(time);
                await TrackPlayer.play();
                setDraggingIndexImmi(undefined);
            }
        }
    };

    const tapGesture = Gesture.Tap()
        .onStart(() => {
            onTurnPageClick?.();
        })
        .runOnJS(true);

    const unlinkTapGesture = Gesture.Tap()
        .onStart(() => {
            if (currentMusicItem) {
                lyricManager.unassociateLyric(currentMusicItem);
            }
        })
        .runOnJS(true);

    return (
        <>
            <GestureDetector gesture={tapGesture}>
                <View style={globalStyle.fwflex1}>
                    {loading ? (
                        <Loading color="white" />
                    ) : lyrics?.length ? (
                        <FlatList
                            ref={_ => {
                                listRef.current = _;
                            }}
                            onLayout={e => {
                                setLayout(e.nativeEvent.layout);
                            }}
                            viewabilityConfig={{
                                itemVisiblePercentThreshold: 100,
                            }}
                            onScrollToIndexFailed={({ index }) => {
                                delay(120).then(() => {
                                    listRef.current?.scrollToIndex({
                                        index: Math.min(
                                            index ?? 0,
                                            lyrics.length - 1,
                                        ),
                                        viewPosition: 0.5,
                                    });
                                });
                            }}
                            fadingEdgeLength={120}
                            ListHeaderComponent={
                                <>
                                    {blankComponent}
                                    <View style={styles.lyricMeta}>
                                        {associateMusicItem ? (
                                            <>
                                                <Text
                                                    style={[
                                                        styles.lyricMetaText,
                                                        fontSizeStyle,
                                                    ]}
                                                    ellipsizeMode="middle"
                                                    numberOfLines={1}>
                                                    {t("lyric.lyricLinkedFrom", {
                                                        platform: associateMusicItem.platform,
                                                        title: associateMusicItem.title || "",
                                                    })}

                                                </Text>

                                                <GestureDetector
                                                    gesture={unlinkTapGesture}>
                                                    <Text
                                                        style={[
                                                            styles.linkText,
                                                            fontSizeStyle,
                                                        ]}>
                                                        {t("lyric.unlinkLyric")}
                                                    </Text>
                                                </GestureDetector>
                                            </>
                                        ) : lyricSourceText ? (
                                            <Text
                                                style={[
                                                    styles.lyricMetaText,
                                                    fontSizeStyle,
                                                ]}
                                                ellipsizeMode="tail"
                                                numberOfLines={1}>
                                                {lyricSourceText}
                                            </Text>
                                        ) : null}
                                    </View>
                                </>
                            }
                            ListFooterComponent={blankComponent}
                            onScrollBeginDrag={onScrollBeginDrag}
                            onMomentumScrollEnd={onScrollEndDrag}
                            onScroll={onScroll}
                            scrollEventThrottle={32}
                            style={styles.wrapper}
                            data={lyrics}
                            initialNumToRender={30}
                            overScrollMode="never"
                            extraData={{
                                currentLrcItem,
                                showTranslation,
                                showRomanization,
                                secondaryFontScale,
                                lyricOrder,
                                detailAlign,
                            }}
                            renderItem={({ item, index }) => {
                                return (
                                    <LyricItemComponent
                                        index={index}
                                        lines={buildDetailLyricLines(
                                            item,
                                            lyricOrder,
                                            !!showTranslation,
                                            hasTranslation,
                                            !!showRomanization,
                                            hasRomanization,
                                            lyrics[index + 1],
                                        )}
                                        fontSize={fontSizeStyle.fontSize}
                                        secondaryFontScale={secondaryFontScale}
                                        textAlign={detailAlign}
                                        onLayout={handleLyricItemLayout}
                                        light={draggingIndex === index}
                                        highlight={
                                            currentLrcItem?.index === index
                                        }
                                    />
                                );
                            }}
                        />
                    ) : (
                        <View style={globalStyle.fullCenter}>
                            <Text style={[styles.white, fontSizeStyle]}>
                                {t("lyric.noLyric")}
                            </Text>
                            {noLyricReasonText ? (
                                <Text style={[styles.noLyricReason, fontSizeStyle]}>
                                    {noLyricReasonText}
                                </Text>
                            ) : null}
                            <TapGestureHandler
                                onActivated={() => {
                                    showPanel("SearchLrc", {
                                        musicItem:
                                            TrackPlayer.currentMusic,
                                    });
                                }}>
                                <Text
                                    style={[styles.searchLyric, fontSizeStyle]}>
                                    {t("lyric.searchLyric")}
                                </Text>
                            </TapGestureHandler>
                        </View>
                    )}
                    {draggingIndex !== undefined && (
                        <View
                            style={[
                                styles.draggingTime,
                                layout?.height
                                    ? {
                                        top:
                                            (layout.height - ITEM_HEIGHT) / 2,
                                    }
                                    : null,
                            ]}>
                            <DraggingTime
                                time={
                                    (lyrics[draggingIndex]?.time ?? 0) +
                                    +(meta?.offset ?? 0)
                                }
                            />
                            <View style={styles.singleLine} />

                            <IconButtonWithGesture
                                style={styles.playIcon}
                                sizeType='normal'
                                name="play"
                                onPress={onLyricSeekPress}
                            />
                        </View>
                    )}
                </View>
            </GestureDetector>
            {immersiveMode ? null : (
                <LyricOperations
                    scrollToCurrentLrcItem={delayedScrollToCurrentLrcItem}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        marginVertical: rpx(48),
        flex: 1,
    },
    empty: {
        paddingTop: "70%",
    },
    white: {
        color: "white",
    },
    lyricMeta: {
        position: "absolute",
        width: "100%",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        left: 0,
        paddingHorizontal: rpx(48),
        bottom: rpx(48),
    },
    lyricMetaText: {
        color: "white",
        opacity: 0.8,
        maxWidth: "80%",
    },
    linkText: {
        color: "#66ccff",
        textDecorationLine: "underline",
    },
    draggingTime: {
        position: "absolute",
        width: "100%",
        height: ITEM_HEIGHT,
        top: "40%",
        marginTop: rpx(48),
        paddingHorizontal: rpx(18),
        right: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    draggingTimeText: {
        color: "#dddddd",
        fontSize: fontSizeConst.description,
        width: rpx(90),
    },
    singleLine: {
        width: "67%",
        height: 1,
        backgroundColor: "#cccccc",
        opacity: 0.4,
    },
    playIcon: {
        width: rpx(100),
        textAlign: "right",
        color: "white",
    },
    searchLyric: {
        width: rpx(180),
        marginTop: rpx(14),
        paddingVertical: rpx(10),
        textAlign: "center",
        alignSelf: "center",
        color: "#66eeff",
        textDecorationLine: "underline",
    },
    noLyricReason: {
        color: "white",
        opacity: 0.7,
        maxWidth: "82%",
        marginTop: rpx(12),
        textAlign: "center",
    },
});
