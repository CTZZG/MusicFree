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
import DraggingTime from "./draggingTime";
import LyricItemComponent from "./lyricItem";
import PersistStatus from "@/utils/persistStatus";
import LyricOperations from "./lyricOperations";
import { IParsedLrcItem } from "@/utils/lrcParser";
import { IconButtonWithGesture } from "@/components/base/iconButton.tsx";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import lyricManager, {
    useCurrentPositionMs,
    useLyricState,
    useNormalizedCurrentLyricState,
} from "@/core/lyricManager";
import { useI18N } from "@/core/i18n";
import { useAppConfig } from "@/core/appConfig";
import { getLyricWordData } from "@/utils/lyricWordByWord";
import {
    createLyricPayloadIdentity,
    getLyricScrollTargetIndex,
    resolveLyricRestoreIndex,
} from "./lyricScrollState";
import { getLyricSeekTimeSeconds } from "./lyricSeekPolicy";

const ITEM_HEIGHT = rpx(92);
const SCROLL_FOLLOW_LEAD_MS = 120;

enum ScrollPhase {
    WaitingForContent,
    InitialPositioning,
    Tracking,
    UserDragging,
}

class LayoutCache {
    private heights: number[];
    private prefixSums: number[];
    private headerHeight = 0;
    private dirty = false;

    constructor(count: number) {
        this.heights = new Array(count).fill(ITEM_HEIGHT);
        this.prefixSums = new Array(count + 1).fill(0);
        this.rebuild();
    }

    reset(count: number) {
        this.heights = new Array(count).fill(ITEM_HEIGHT);
        this.prefixSums = new Array(count + 1).fill(0);
        this.headerHeight = 0;
        this.rebuild();
    }

    setHeaderHeight(height: number) {
        if (this.headerHeight !== height) {
            this.headerHeight = height;
            return true;
        }
        return false;
    }

    setItemHeight(index: number, height: number) {
        if (
            index >= 0 &&
            index < this.heights.length &&
            this.heights[index] !== height
        ) {
            this.heights[index] = height;
            this.dirty = true;
            return true;
        }
        return false;
    }

    getItemLayout(index: number) {
        this.ensureClean();
        const safeIndex = this.clampIndex(index);
        return {
            length: this.heights[safeIndex] ?? ITEM_HEIGHT,
            offset: this.headerHeight + (this.prefixSums[safeIndex] ?? 0),
            index: safeIndex,
        };
    }

    findIndexAtOffset(contentOffset: number) {
        this.ensureClean();
        if (!this.heights.length) {
            return -1;
        }

        const target = contentOffset - this.headerHeight;
        if (target <= 0) {
            return 0;
        }

        let low = 0;
        let high = this.heights.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >>> 1;
            if (this.prefixSums[middle] <= target) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return low;
    }

    private rebuild() {
        this.prefixSums[0] = 0;
        for (let index = 0; index < this.heights.length; index += 1) {
            this.prefixSums[index + 1] =
                this.prefixSums[index] + this.heights[index];
        }
        this.dirty = false;
    }

    private ensureClean() {
        if (this.dirty) {
            this.rebuild();
        }
    }

    private clampIndex(index: number) {
        if (!this.heights.length) {
            return 0;
        }
        return Math.max(0, Math.min(index, this.heights.length - 1));
    }
}

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
    const normalizedCurrentLyricState = useNormalizedCurrentLyricState();
    const currentLyricIndex = normalizedCurrentLyricState.line?.index ?? -1;
    const currentPositionMs = useCurrentPositionMs();
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
    const isAmlLiteMode =
        PersistStatus.useValue("lyric.detailAmlLiteMode", false) === true;
    const lyricOffsetSecondsRaw = Number(meta?.offset ?? 0);
    const lyricOffsetSeconds = Number.isFinite(lyricOffsetSecondsRaw)
        ? lyricOffsetSecondsRaw
        : 0;
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
    const suppressTurnPageTapRef = useRef(false);
    const suppressTurnPageTapTimerRef =
        useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const currentMusicItem = useCurrentMusic();

    useEffect(() => {
        lyricManager.hydrateCurrentPosition();
    }, [currentMusicItem?.id, currentMusicItem?.platform]);

    const activeLyricIndexRef = useRef(currentLyricIndex);
    activeLyricIndexRef.current = currentLyricIndex;
    const lyricsIdentity = useMemo(
        () => createLyricPayloadIdentity(currentMusicItem, lyrics),
        [currentMusicItem, lyrics],
    );
    const scrollTargetIndex = useMemo(
        () =>
            getLyricScrollTargetIndex(
                lyrics,
                currentPositionMs,
                lyricOffsetSeconds,
                SCROLL_FOLLOW_LEAD_MS,
            ),
        [currentPositionMs, lyricOffsetSeconds, lyrics],
    );
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

    const scrollPhaseRef = useRef<ScrollPhase>(
        ScrollPhase.WaitingForContent,
    );
    const lastScrollIndexRef = useRef(-1);
    const restoreScrollIndexRef = useRef(-1);
    const initialPositionFrameRef = useRef<number | null>(null);
    const lastLyricsIdentityRef = useRef(lyricsIdentity);
    const layoutCacheRef = useRef(new LayoutCache(lyrics.length));
    const [isListReady, setIsListReady] = useState(false);
    const [shouldApplyInitialContentOffset, setShouldApplyInitialContentOffset] =
        useState(true);
    const lyricOrderKey = useMemo(() => lyricOrder.join("|"), [lyricOrder]);
    const layoutAffectingKey = useMemo(
        () =>
            [
                fontSizeKey,
                secondaryFontScale,
                showTranslation && hasTranslation ? "translation" : "no-translation",
                showRomanization && hasRomanization ? "romanization" : "no-romanization",
                lyricOrderKey,
                detailAlign,
                isAmlLiteMode ? "amll-lite" : "classic",
            ].join("|"),
        [
            detailAlign,
            fontSizeKey,
            hasRomanization,
            hasTranslation,
            isAmlLiteMode,
            lyricOrderKey,
            secondaryFontScale,
            showRomanization,
            showTranslation,
        ],
    );

    const getActiveLyricIndex = useCallback(
        () =>
            resolveLyricRestoreIndex({
                lyricsLength: lyrics.length,
                activeIndex: activeLyricIndexRef.current,
            }),
        [lyrics.length],
    );

    const getRestoreScrollIndex = useCallback(
        () =>
            resolveLyricRestoreIndex({
                lyricsLength: lyrics.length,
                activeIndex: activeLyricIndexRef.current,
                restoreIndex: restoreScrollIndexRef.current,
            }),
        [lyrics.length],
    );

    const scrollToIndex = useCallback(
        (index: number, animated: boolean) => {
            if (!listRef.current || !lyrics.length) {
                return;
            }
            const safeIndex = Math.max(0, Math.min(index, lyrics.length - 1));
            if (safeIndex === lastScrollIndexRef.current && animated) {
                return;
            }
            listRef.current.scrollToIndex({
                index: safeIndex,
                viewPosition: 0.5,
                animated,
            });
            lastScrollIndexRef.current = safeIndex;
        },
        [lyrics.length],
    );

    const cancelInitialPositioning = useCallback(() => {
        if (initialPositionFrameRef.current !== null) {
            cancelAnimationFrame(initialPositionFrameRef.current);
            initialPositionFrameRef.current = null;
        }
    }, []);

    const finishInitialPositioning = useCallback(() => {
        initialPositionFrameRef.current = null;

        if (!lyrics.length) {
            setIsListReady(true);
            setShouldApplyInitialContentOffset(false);
            scrollPhaseRef.current = ScrollPhase.Tracking;
            return;
        }

        if (!listRef.current) {
            return;
        }

        const targetIndex = getRestoreScrollIndex();
        if (targetIndex !== -1) {
            scrollToIndex(targetIndex, false);
            restoreScrollIndexRef.current = targetIndex;
        }

        setIsListReady(true);
        setShouldApplyInitialContentOffset(false);
        scrollPhaseRef.current = ScrollPhase.Tracking;
    }, [getRestoreScrollIndex, lyrics.length, scrollToIndex]);

    const scheduleInitialPositioning = useCallback(() => {
        cancelInitialPositioning();
        initialPositionFrameRef.current = requestAnimationFrame(
            finishInitialPositioning,
        );
    }, [cancelInitialPositioning, finishInitialPositioning]);

    useEffect(() => {
        const isNewLyricPayload =
            lastLyricsIdentityRef.current !== lyricsIdentity;
        lastLyricsIdentityRef.current = lyricsIdentity;
        restoreScrollIndexRef.current = isNewLyricPayload
            ? -1
            : getRestoreScrollIndex();
        layoutCacheRef.current.reset(lyrics.length);
        scrollPhaseRef.current = ScrollPhase.InitialPositioning;
        lastScrollIndexRef.current = -1;
        if (isNewLyricPayload) {
            setShouldApplyInitialContentOffset(true);
        }
        setIsListReady(false);
        scheduleInitialPositioning();
    }, [
        getRestoreScrollIndex,
        layoutAffectingKey,
        lyrics,
        lyricsIdentity,
        scheduleInitialPositioning,
    ]);

    useEffect(() => {
        scrollPhaseRef.current = ScrollPhase.WaitingForContent;
        lastScrollIndexRef.current = -1;
        restoreScrollIndexRef.current = -1;
        setShouldApplyInitialContentOffset(true);
        setIsListReady(false);
    }, [currentMusicItem?.id]);

    useEffect(() => {
        restoreScrollIndexRef.current = getActiveLyricIndex();
    }, [currentLyricIndex, getActiveLyricIndex]);

    useEffect(() => {
        return cancelInitialPositioning;
    }, [cancelInitialPositioning]);

    useEffect(() => {
        return () => {
            if (suppressTurnPageTapTimerRef.current) {
                clearTimeout(suppressTurnPageTapTimerRef.current);
            }
        };
    }, []);

    const initialContentOffset = useMemo(() => {
        const targetIndex = getActiveLyricIndex();
        if (targetIndex <= 0 || !lyrics.length) {
            return undefined;
        }
        return {
            x: 0,
            y: Math.max(0, targetIndex * ITEM_HEIGHT),
        };
    }, [getActiveLyricIndex, lyrics.length, lyricsIdentity]);

    // 设置空白组件，获取组件高度
    const blankComponent = useMemo(() => {
        return (
            <View
                style={styles.empty}
                onLayout={evt => {
                    const didChange = layoutCacheRef.current.setHeaderHeight(
                        evt.nativeEvent.layout.height,
                    );
                    if (
                        didChange &&
                        scrollPhaseRef.current === ScrollPhase.InitialPositioning
                    ) {
                        scheduleInitialPositioning();
                    }
                }}
            />
        );
    }, [scheduleInitialPositioning]);

    const handleLyricItemLayout = useCallback(
        (index: number, height: number) => {
            const didChange = layoutCacheRef.current.setItemHeight(index, height);
            if (
                didChange &&
                scrollPhaseRef.current === ScrollPhase.InitialPositioning
            ) {
                scheduleInitialPositioning();
            }
        },
        [scheduleInitialPositioning],
    );

    const getItemLayout = useCallback((_data: any, index: number) => {
        return layoutCacheRef.current.getItemLayout(index);
    }, []);

    // 滚到当前item
    const scrollToCurrentLrcItem = useCallback(() => {
        if (!listRef.current || !lyrics.length || !layout?.height) {
            return;
        }
        const currentIndex = getActiveLyricIndex();
        lastScrollIndexRef.current = -1;
        scrollToIndex(currentIndex === -1 ? 0 : currentIndex, true);
        restoreScrollIndexRef.current = currentIndex;
        scrollPhaseRef.current = ScrollPhase.Tracking;
    }, [getActiveLyricIndex, layout?.height, lyrics.length, scrollToIndex]);

    const delayedScrollToCurrentLrcItem = useMemo(() => {
        let sto: ReturnType<typeof setTimeout> | undefined;

        return () => {
            if (sto) {
                clearTimeout(sto);
            }
            sto = setTimeout(() => {
                scrollToCurrentLrcItem();
            }, 200);
        };
    }, [scrollToCurrentLrcItem]);

    const onContentSizeChange = useCallback(() => {
        if (!listRef.current || !lyrics.length) {
            return;
        }
        if (scrollPhaseRef.current === ScrollPhase.WaitingForContent) {
            scrollPhaseRef.current = ScrollPhase.InitialPositioning;
            lastScrollIndexRef.current = -1;
        }
        if (scrollPhaseRef.current === ScrollPhase.InitialPositioning) {
            scheduleInitialPositioning();
        }
    }, [lyrics.length, scheduleInitialPositioning]);

    useEffect(() => {
        if (scrollPhaseRef.current !== ScrollPhase.Tracking) {
            return;
        }
        if (
            lyrics.length === 0 ||
            draggingIndex !== undefined ||
            musicIsPaused(musicState) ||
            lyrics[lyrics.length - 1].time < 1
        ) {
            return;
        }
        const targetIndex =
            scrollTargetIndex === -1 ? getActiveLyricIndex() : scrollTargetIndex;
        if (targetIndex === lastScrollIndexRef.current) {
            return;
        }
        scrollToIndex(targetIndex === -1 ? 0 : targetIndex, true);
    }, [
        draggingIndex,
        getActiveLyricIndex,
        lyrics,
        musicState,
        scrollTargetIndex,
        scrollToIndex,
    ]);

    // 开始滚动时拖拽生效
    const onScrollBeginDrag = useCallback(() => {
        scrollPhaseRef.current = ScrollPhase.UserDragging;
    }, []);

    const onScrollEndDrag = useCallback(() => {
        if (draggingIndex !== undefined) {
            setDraggingIndex(undefined);
        }
        lastScrollIndexRef.current = -1;
        scrollPhaseRef.current = ScrollPhase.Tracking;
    }, [draggingIndex, setDraggingIndex]);

    const onScroll = useCallback(
        (e: any) => {
            if (scrollPhaseRef.current !== ScrollPhase.UserDragging) {
                return;
            }
            const centerOffset =
                e.nativeEvent.contentOffset.y +
                e.nativeEvent.layoutMeasurement.height / 2;
            const index = layoutCacheRef.current.findIndexAtOffset(centerOffset);
            if (index >= 0) {
                setDraggingIndex(Math.min(index, lyrics.length - 1));
            }
        },
        [lyrics.length, setDraggingIndex],
    );

    const listExtraData = useMemo(
        () =>
            [
                currentLyricIndex,
                draggingIndex ?? -1,
                layoutAffectingKey,
            ].join("|"),
        [currentLyricIndex, draggingIndex, layoutAffectingKey],
    );

    useEffect(() => {
        if (isListReady) {
            return;
        }
        const timeout = setTimeout(() => {
            if (lyrics.length) {
                setIsListReady(true);
                setShouldApplyInitialContentOffset(false);
                scrollPhaseRef.current = ScrollPhase.Tracking;
            }
        }, 500);
        return () => clearTimeout(timeout);
    }, [isListReady, lyrics.length]);

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

    const markLyricLineTapHandled = useCallback(() => {
        suppressTurnPageTapRef.current = true;
        if (suppressTurnPageTapTimerRef.current) {
            clearTimeout(suppressTurnPageTapTimerRef.current);
        }
        suppressTurnPageTapTimerRef.current = setTimeout(() => {
            suppressTurnPageTapRef.current = false;
        }, 350);
    }, []);

    const handleTurnPageTap = useCallback(() => {
        if (suppressTurnPageTapRef.current) {
            suppressTurnPageTapRef.current = false;
            return;
        }
        onTurnPageClick?.();
    }, [onTurnPageClick]);

    const handleLyricLinePress = useCallback(
        async (index: number) => {
            const item = lyrics[index];
            const seekTime = getLyricSeekTimeSeconds(
                item,
                lyrics,
                lyricOffsetSeconds,
            );
            if (seekTime === undefined) {
                return;
            }
            restoreScrollIndexRef.current = index;
            lastScrollIndexRef.current = -1;
            scrollPhaseRef.current = ScrollPhase.Tracking;
            scrollToIndex(index, true);
            await TrackPlayer.seekTo(seekTime);
        },
        [lyricOffsetSeconds, lyrics, scrollToIndex],
    );

    const tapGesture = Gesture.Tap()
        .onEnd((_event, success) => {
            if (success) {
                handleTurnPageTap();
            }
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
                <View
                    style={[
                        globalStyle.fwflex1,
                        isAmlLiteMode ? styles.amllLiteShell : null,
                    ]}>
                    {isAmlLiteMode ? (
                        <View
                            pointerEvents="none"
                            style={styles.amllLiteBackdrop}
                        />
                    ) : null}
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
                            contentOffset={
                                shouldApplyInitialContentOffset
                                    ? initialContentOffset
                                    : undefined
                            }
                            viewabilityConfig={{
                                itemVisiblePercentThreshold: 100,
                            }}
                            onScrollToIndexFailed={({ index }) => {
                                requestAnimationFrame(() => {
                                    scrollToIndex(index ?? 0, false);
                                    restoreScrollIndexRef.current = index ?? 0;
                                    setShouldApplyInitialContentOffset(false);
                                    setIsListReady(true);
                                });
                            }}
                            fadingEdgeLength={120}
                            onContentSizeChange={onContentSizeChange}
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
                            scrollEventThrottle={16}
                            style={[
                                styles.wrapper,
                                { opacity: isListReady ? 1 : 0 },
                            ]}
                            data={lyrics}
                            initialNumToRender={30}
                            windowSize={7}
                            maxToRenderPerBatch={10}
                            updateCellsBatchingPeriod={50}
                            removeClippedSubviews={false}
                            getItemLayout={getItemLayout}
                            maintainVisibleContentPosition={{
                                minIndexForVisible: 0,
                            }}
                            overScrollMode="never"
                            extraData={listExtraData}
                            renderItem={({ item, index }) => {
                                const seekTime = getLyricSeekTimeSeconds(
                                    item,
                                    lyrics,
                                    lyricOffsetSeconds,
                                );
                                const canTapSeek = seekTime !== undefined;
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
                                        highlight={currentLyricIndex === index}
                                        amllLiteMode={isAmlLiteMode}
                                        onPressIn={
                                            canTapSeek
                                                ? markLyricLineTapHandled
                                                : undefined
                                        }
                                        onPress={
                                            canTapSeek
                                                ? () => handleLyricLinePress(index)
                                                : undefined
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
    amllLiteShell: {
        paddingHorizontal: rpx(8),
        paddingTop: rpx(8),
        paddingBottom: rpx(4),
    },
    amllLiteBackdrop: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: "rgba(255, 255, 255, 0.07)",
        borderRadius: rpx(28),
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
