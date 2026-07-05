import {
    localMusicSheetId,
    musicHistorySheetId,
    RequestStateCode,
} from "@/constants/commonConst";
import downloader from "@/core/downloader";
import { useI18N } from "@/core/i18n";
import LocalMusicSheet from "@/core/localMusicSheet";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import React, {
    useRef,
    useCallback,
    useState,
    useEffect,
    useMemo,
} from "react";
import {
    FlatListProps,
    type GestureResponderEvent,
    type LayoutChangeEvent,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import CheckBox from "../base/checkbox";
import ThemeText from "../base/themeText";
import ListEmpty from "../base/listEmpty";
import ListFooter from "../base/listFooter";
import MusicItem from "../mediaItem/musicItem";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import Icon from "../base/icon";
import { iconSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { IIconName } from "../base/icon.tsx";
import { showPanel } from "../panels/usePanel";
import {
    buildMusicAlphabetIndex,
    getMusicAlphabetEntryAtOffset,
    type IMusicAlphabetIndexEntry,
} from "@/utils/musicAlphabetIndex";

interface IMusicListProps {
    /** 顶部 */
    Header?: FlatListProps<IMusic.IMusicItem>["ListHeaderComponent"];
    /** 音乐列表 */
    musicList?: IMusic.IMusicItem[];
    /** 所在歌单 */
    musicSheet?: IMusic.IMusicSheetItem;
    /** 是否展示序号 */
    showIndex?: boolean;
    /** 点击 */
    onItemPress?: (
        musicItem: IMusic.IMusicItem,
        musicList?: IMusic.IMusicItem[],
    ) => void;
    // 状态
    state: RequestStateCode;
    /** 高亮的音乐 */
    highlightMusicItem?: IMusic.IMusicItem | null;
    onRetry?: () => void;
    onLoadMore?: () => void;
    showArtwork?: boolean;
    showQuality?: boolean;
    showDuration?: boolean;
    showAddNextIcon?: boolean;
    enableAlphabetIndex?: boolean;
    alphabetIndexText?: (musicItem: IMusic.IMusicItem) => unknown;
}
/** 音乐列表 */
export default function MusicList(props: IMusicListProps) {
    const {
        Header,
        musicList,
        musicSheet,
        showIndex,
        onItemPress,
        state,
        onRetry,
        onLoadMore,
        highlightMusicItem,
        showArtwork,
        showQuality,
        showDuration,
        showAddNextIcon,
        enableAlphabetIndex,
        alphabetIndexText,
    } = props;    
    const colors = useColors();
    const { t } = useI18N();
    const flashListRef = useRef<FlashListRef<IMusic.IMusicItem>>(null);
    const visibleIndicesRef = useRef<Set<number>>(new Set());
    const hasViewableSnapshotRef = useRef(false);
    const highlightIndexRef = useRef(-1);
    const lastTouchedAlphabetSectionRef = useRef<string | null>(null);
    const [highlightIsViewable, setHighlightIsViewable] = useState(true);
    const [alphabetIndexHeight, setAlphabetIndexHeight] = useState(0);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
        () => new Set(),
    );
    const [selectionAnchorIndex, setSelectionAnchorIndex] =
        useState<number | null>(null);
    const selectionMode = selectedKeys.size > 0;
    const canRemoveSelected = !!musicSheet?.id;
    const alphabetIndexEntries = useMemo(
        () =>
            enableAlphabetIndex
                ? buildMusicAlphabetIndex(
                    musicList ?? [],
                    alphabetIndexText ?? (musicItem => musicItem.title),
                )
                : [],
        [alphabetIndexText, enableAlphabetIndex, musicList],
    );
    const shouldShowAlphabetIndex =
        !!enableAlphabetIndex &&
        !selectionMode &&
        (musicList?.length ?? 0) >= 20 &&
        alphabetIndexEntries.some(item => item.available);

    // 查找高亮项的索引
    const highlightIndex = React.useMemo(() => {
        if (!highlightMusicItem || !musicList) return -1;
        return musicList.findIndex(item => isSameMediaItem(item, highlightMusicItem));
    }, [highlightMusicItem, musicList]);    

    highlightIndexRef.current = highlightIndex;

    const syncHighlightVisibility = useCallback((indices?: Set<number>) => {
        const currentHighlightIndex = highlightIndexRef.current;
        const currentVisibleIndices = indices ?? visibleIndicesRef.current;
        const nextIsViewable =
            currentHighlightIndex === -1 ||
            !hasViewableSnapshotRef.current ||
            currentVisibleIndices.has(currentHighlightIndex);

        setHighlightIsViewable(prev =>
            prev === nextIsViewable ? prev : nextIsViewable,
        );
    }, []);

    const handleViewableItemsChanged = useCallback(
        (info: { viewableItems: Array<{ index: number | null }> }) => {
            const nextVisibleIndices = new Set<number>();
            info.viewableItems.forEach(item => {
                if (typeof item.index === "number") {
                    nextVisibleIndices.add(item.index);
                }
            });
            visibleIndicesRef.current = nextVisibleIndices;
            hasViewableSnapshotRef.current = true;
            syncHighlightVisibility(nextVisibleIndices);
        },
        [syncHighlightVisibility],
    );

    const viewabilityConfig = useMemo(
        () => ({
            itemVisiblePercentThreshold: 1,
        }),
        [],
    );
    
    // 滚动到高亮项
    const scrollToHighlight = useCallback(() => {
        if (highlightIndex !== -1 && flashListRef.current) {
            flashListRef.current.scrollToIndex({
                index: highlightIndex,
                animated: true,
                viewPosition: 0.35,
            });
        }
    }, [highlightIndex]);    

    const scrollToAlphabetSection = useCallback(
        (entry: IMusicAlphabetIndexEntry) => {
            if (entry.index === null || !flashListRef.current) {
                return;
            }

            void flashListRef.current.scrollToIndex({
                index: entry.index,
                animated: true,
                viewPosition: 0,
            });
        },
        [],
    );

    const scrollToAlphabetOffset = useCallback(
        (offsetY: number) => {
            const entry = getMusicAlphabetEntryAtOffset(
                alphabetIndexEntries,
                offsetY,
                alphabetIndexHeight,
            );

            if (!entry?.available || entry.index === null) {
                return;
            }
            if (lastTouchedAlphabetSectionRef.current === entry.section) {
                return;
            }

            lastTouchedAlphabetSectionRef.current = entry.section;
            scrollToAlphabetSection(entry);
        },
        [alphabetIndexEntries, alphabetIndexHeight, scrollToAlphabetSection],
    );

    const handleAlphabetIndexLayout = useCallback((event: LayoutChangeEvent) => {
        setAlphabetIndexHeight(event.nativeEvent.layout.height);
    }, []);

    const handleAlphabetIndexTouch = useCallback(
        (event: GestureResponderEvent) => {
            scrollToAlphabetOffset(event.nativeEvent.locationY);
        },
        [scrollToAlphabetOffset],
    );

    const resetAlphabetTouch = useCallback(() => {
        lastTouchedAlphabetSectionRef.current = null;
    }, []);
    
    useEffect(() => {
        syncHighlightVisibility();
    }, [highlightIndex, musicList?.length, syncHighlightVisibility]);

    useEffect(() => {
        if (!musicList?.length) {
            setSelectedKeys(prev => (prev.size ? new Set() : prev));
            setSelectionAnchorIndex(prev => (prev === null ? prev : null));
            return;
        }
        setSelectedKeys(prev => {
            const validKeys = new Set(musicList.map(item => getMediaUniqueKey(item)));
            const next = new Set<string>();
            let changed = false;
            prev.forEach(key => {
                if (validKeys.has(key)) {
                    next.add(key);
                } else {
                    changed = true;
                }
            });
            if (!changed && next.size === prev.size) {
                return prev;
            }
            if (!next.size) {
                setSelectionAnchorIndex(prevAnchor =>
                    prevAnchor === null ? prevAnchor : null,
                );
            }
            return next;
        });
    }, [musicList]);

    const selectedItems = useMemo(
        () =>
            (musicList ?? []).filter(item =>
                selectedKeys.has(getMediaUniqueKey(item)),
            ),
        [musicList, selectedKeys],
    );

    const selectedCount = selectedItems.length;
    const shouldShowLocateBadge =
        !selectionMode && highlightIndex !== -1 && !highlightIsViewable;

    const clearSelection = useCallback(() => {
        setSelectedKeys(new Set());
        setSelectionAnchorIndex(null);
    }, []);

    const selectAll = useCallback(() => {
        const list = musicList ?? [];
        setSelectedKeys(new Set(list.map(item => getMediaUniqueKey(item))));
        setSelectionAnchorIndex(list.length ? 0 : null);
    }, [musicList]);

    const toggleSelectionAt = useCallback(
        (index: number, musicItem: IMusic.IMusicItem) => {
            const key = getMediaUniqueKey(musicItem);
            setSelectedKeys(prev => {
                if (
                    selectionAnchorIndex !== null &&
                    prev.size === 1 &&
                    !prev.has(key)
                ) {
                    const start = Math.min(selectionAnchorIndex, index);
                    const end = Math.max(selectionAnchorIndex, index);
                    const next = new Set(prev);
                    (musicList ?? []).slice(start, end + 1).forEach(item => {
                        next.add(getMediaUniqueKey(item));
                    });
                    return next;
                }

                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                    if (!next.size) {
                        setSelectionAnchorIndex(null);
                    }
                } else {
                    next.add(key);
                    if (selectionAnchorIndex === null) {
                        setSelectionAnchorIndex(index);
                    }
                }
                return next;
            });
        },
        [musicList, selectionAnchorIndex],
    );

    const enterSelectionMode = useCallback(
        (index: number, musicItem: IMusic.IMusicItem) => {
            setSelectedKeys(new Set([getMediaUniqueKey(musicItem)]));
            setSelectionAnchorIndex(index);
        },
        [],
    );

    // 用 ref 持有最新依赖，使传给每个列表项的回调保持稳定引用，
    // 避免 musicList / selectionAnchorIndex 变化时所有 item 的回调全部失效。
    const itemPressContextRef = useRef({
        selectionMode,
        onItemPress,
        musicList,
        toggleSelectionAt,
        enterSelectionMode,
    });
    itemPressContextRef.current = {
        selectionMode,
        onItemPress,
        musicList,
        toggleSelectionAt,
        enterSelectionMode,
    };

    const handleItemPress = useCallback(
        (index: number, musicItem: IMusic.IMusicItem) => {
            const ctx = itemPressContextRef.current;
            if (ctx.selectionMode) {
                ctx.toggleSelectionAt(index, musicItem);
            } else if (ctx.onItemPress) {
                ctx.onItemPress(musicItem, ctx.musicList);
            } else {
                TrackPlayer.playWithReplacePlayList(
                    musicItem,
                    ctx.musicList ?? [musicItem],
                );
            }
        },
        [],
    );

    const handleItemLongPress = useCallback(
        (index: number, musicItem: IMusic.IMusicItem) => {
            itemPressContextRef.current.enterSelectionMode(index, musicItem);
        },
        [],
    );

    const renderItem = useCallback(
        ({
            index,
            item: musicItem,
        }: {
            index: number;
            item: IMusic.IMusicItem;
        }) => {
            return (
                <MusicListItem
                    musicItem={musicItem}
                    rawIndex={index}
                    displayIndex={showIndex ? index + 1 : undefined}
                    selectionMode={selectionMode}
                    selected={selectedKeys.has(getMediaUniqueKey(musicItem))}
                    highlight={isSameMediaItem(musicItem, highlightMusicItem)}
                    musicSheet={musicSheet}
                    itemPaddingRight={
                        shouldShowAlphabetIndex ? rpx(58) : undefined
                    }
                    showArtwork={showArtwork}
                    showQuality={showQuality}
                    showDuration={showDuration}
                    showAddNextIcon={showAddNextIcon}
                    onPress={handleItemPress}
                    onLongPress={handleItemLongPress}
                />
            );
        },
        [
            showIndex,
            selectionMode,
            selectedKeys,
            highlightMusicItem,
            musicSheet,
            shouldShowAlphabetIndex,
            showArtwork,
            showQuality,
            showDuration,
            showAddNextIcon,
            handleItemPress,
            handleItemLongPress,
        ],
    );

    const keyExtractor = useCallback(
        (item: IMusic.IMusicItem) => getMediaUniqueKey(item),
        [],
    );

    const removeSelectedItems = useCallback(async () => {
        if (!canRemoveSelected || !musicSheet?.id || !selectedItems.length) {
            return;
        }
        if (musicSheet.id === localMusicSheetId) {
            for (const musicItem of selectedItems) {
                await LocalMusicSheet.removeMusic(musicItem);
            }
        } else if (musicSheet.id === musicHistorySheetId) {
            for (const musicItem of selectedItems) {
                await musicHistory.removeMusic(musicItem);
            }
        } else {
            await MusicSheet.removeMusic(musicSheet.id, selectedItems);
        }
        Toast.success(t("toast.deleteSuccess"));
        clearSelection();
    }, [canRemoveSelected, clearSelection, musicSheet?.id, selectedItems, t]);

    const renderHeader = useCallback(() => {
        const headerNode = typeof Header === "function"
            ? React.createElement(Header as React.ComponentType<any>)
            : Header;
        return (
            <>
                {headerNode}
                {selectionMode ? (
                    <View style={styles.selectionHeader}>
                        <ThemeText fontWeight="bold">
                            {t("musicList.selection.selectedCount", {
                                count: selectedCount,
                            })}
                        </ThemeText>
                        <View style={styles.selectionHeaderActions}>
                            <Pressable
                                style={styles.selectionTextButton}
                                onPress={
                                    selectedCount === (musicList?.length ?? 0)
                                        ? clearSelection
                                        : selectAll
                                }>
                                <ThemeText fontColor="primary">
                                    {selectedCount === (musicList?.length ?? 0)
                                        ? t("common.unselectAll")
                                        : t("common.selectAll")}
                                </ThemeText>
                            </Pressable>
                            <Pressable
                                style={styles.selectionTextButton}
                                onPress={clearSelection}>
                                <ThemeText fontColor="primary">
                                    {t("common.cancel")}
                                </ThemeText>
                            </Pressable>
                        </View>
                    </View>
                ) : null}
            </>
        );
    }, [
        Header,
        clearSelection,
        musicList?.length,
        selectAll,
        selectedCount,
        selectionMode,
        t,
    ]);
    
    return (
        <View style={styles.container}>
            <FlashList
                ref={flashListRef}
                ListHeaderComponent={renderHeader}
                ListEmptyComponent={<ListEmpty state={state} onRetry={onRetry} />}
                ListFooterComponent={
                    <>
                        {musicList?.length ? (
                            <ListFooter state={state} onRetry={onRetry} />
                        ) : null}
                        {selectionMode ? <View style={styles.selectionSpacer} /> : null}
                    </>
                }
                extraData={{
                    highlightMusicItem,
                    selectedKeys,
                    selectionMode,
                }}
                data={musicList ?? []}
                keyExtractor={keyExtractor}
                viewabilityConfig={viewabilityConfig}
                onViewableItemsChanged={handleViewableItemsChanged}
                renderItem={renderItem}
                onEndReached={() => {
                    if (state === RequestStateCode.IDLE || state === RequestStateCode.PARTLY_DONE) {
                        onLoadMore?.();
                    }
                }}
                onEndReachedThreshold={0.1}
            />              
            {shouldShowLocateBadge && (
                <View style={styles.badge} pointerEvents="box-none">
                    <Pressable
                        style={[styles.badgeButton, { backgroundColor: colors.notification }]}
                        onPress={scrollToHighlight}
                    >
                        <Icon
                            name="crosshair"
                            size={iconSizeConst.normal}
                            color={colors.text}
                        />
                    </Pressable>
                </View>
            )}
            {shouldShowAlphabetIndex ? (
                <View
                    style={styles.alphabetIndex}
                    onLayout={handleAlphabetIndexLayout}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={handleAlphabetIndexTouch}
                    onResponderMove={handleAlphabetIndexTouch}
                    onResponderRelease={resetAlphabetTouch}
                    onResponderTerminate={resetAlphabetTouch}>
                    {alphabetIndexEntries.map(entry => (
                        <View
                            key={entry.section}
                            style={styles.alphabetIndexItem}>
                            <ThemeText
                                fontSize="tag"
                                fontWeight="semibold"
                                style={[
                                    styles.alphabetIndexText,
                                    {
                                        color: entry.available
                                            ? colors.text
                                            : colors.textSecondary,
                                        opacity: entry.available ? 0.9 : 0.35,
                                    },
                                ]}>
                                {entry.section}
                            </ThemeText>
                        </View>
                    ))}
                </View>
            ) : null}
            {selectionMode ? (
                <View
                    style={[
                        styles.selectionBottomBar,
                        { backgroundColor: colors.appBar },
                    ]}>
                    <SelectionAction
                        icon="motion-play"
                        title={t("musicListEditor.addToNextPlay")}
                        disabled={!selectedCount}
                        onPress={() => {
                            if (!selectedItems.length) {
                                return;
                            }
                            TrackPlayer.addNext(selectedItems);
                            Toast.success(t("toast.addToNextPlay"));
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="clock-outline"
                        title={t("playLater.add")}
                        disabled={!selectedCount}
                        onPress={() => {
                            if (!selectedItems.length) {
                                return;
                            }
                            TrackPlayer.addPlayLater(selectedItems);
                            Toast.success(t("playLater.added"));
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="folder-plus"
                        title={t("musicListEditor.addToSheet")}
                        disabled={!selectedCount}
                        onPress={() => {
                            if (!selectedItems.length) {
                                return;
                            }
                            showPanel("AddToMusicSheet", {
                                musicItem: selectedItems,
                            });
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="arrow-down-tray"
                        title={t("common.download")}
                        disabled={!selectedCount}
                        onPress={() => {
                            if (!selectedItems.length) {
                                return;
                            }
                            downloader.download(selectedItems);
                            Toast.success(t("toast.beginDownload"));
                            clearSelection();
                        }}
                    />
                    {canRemoveSelected ? (
                        <SelectionAction
                            icon="trash-outline"
                            title={t("common.delete")}
                            disabled={!selectedCount}
                            onPress={() => {
                                void removeSelectedItems();
                            }}
                        />
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

interface IMusicListItemProps {
    musicItem: IMusic.IMusicItem;
    rawIndex: number;
    displayIndex?: number;
    selectionMode: boolean;
    selected: boolean;
    highlight: boolean;
    musicSheet?: IMusic.IMusicSheetItem;
    itemPaddingRight?: number;
    showArtwork?: boolean;
    showQuality?: boolean;
    showDuration?: boolean;
    showAddNextIcon?: boolean;
    onPress: (index: number, musicItem: IMusic.IMusicItem) => void;
    onLongPress: (index: number, musicItem: IMusic.IMusicItem) => void;
}

/**
 * 单个列表项的稳定包装：把选中态/高亮态收敛为布尔 props，配合 React.memo，
 * 让仅状态变化的少数行重渲染，而不是整张列表。
 */
function MusicListItemImpl(props: IMusicListItemProps) {
    const {
        musicItem,
        rawIndex,
        displayIndex,
        selectionMode,
        selected,
        highlight,
        musicSheet,
        itemPaddingRight,
        showArtwork,
        showQuality,
        showDuration,
        showAddNextIcon,
        onPress,
        onLongPress,
    } = props;

    const handlePress = useCallback(() => {
        onPress(rawIndex, musicItem);
    }, [onPress, rawIndex, musicItem]);

    const handleLongPress = useCallback(() => {
        onLongPress(rawIndex, musicItem);
    }, [onLongPress, rawIndex, musicItem]);

    const left = useMemo(() => {
        if (!selectionMode) {
            return undefined;
        }
        return () => (
            <View style={styles.checkBoxWrapper}>
                <CheckBox checked={selected} />
            </View>
        );
    }, [selectionMode, selected]);

    return (
        <MusicItem
            musicItem={musicItem}
            index={showArtwork ? undefined : displayIndex}
            onItemPress={handlePress}
            onItemLongPress={handleLongPress}
            left={left}
            itemPaddingRight={itemPaddingRight}
            showMoreIcon={!selectionMode}
            musicSheet={musicSheet}
            highlight={highlight}
            showArtwork={showArtwork}
            showQuality={showQuality}
            showDuration={showDuration}
            showAddNextIcon={showAddNextIcon && !selectionMode}
        />
    );
}

const MusicListItem = React.memo(MusicListItemImpl);

interface ISelectionActionProps {
    icon: IIconName;
    title: string;
    disabled?: boolean;
    onPress: () => void;
}

function SelectionAction(props: ISelectionActionProps) {
    const { icon, title, disabled, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            style={styles.selectionAction}>
            <Icon
                name={icon}
                size={iconSizeConst.big}
                color={colors.appBarText}
                style={disabled ? styles.disabledAction : undefined}
            />
            <ThemeText
                fontSize="subTitle"
                color={colors.appBarText}
                opacity={disabled ? 0.6 : undefined}
                style={styles.selectionActionText}
                numberOfLines={1}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    badge: {
        position: "absolute",
        bottom: rpx(80),
        right: rpx(84),
        zIndex: 1000,
    },
    badgeButton: {
        width: rpx(64),
        height: rpx(64),
        borderRadius: rpx(32),
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    alphabetIndex: {
        position: "absolute",
        top: rpx(18),
        right: rpx(6),
        bottom: rpx(108),
        width: rpx(42),
        justifyContent: "center",
        alignItems: "center",
        zIndex: 999,
    },
    alphabetIndexItem: {
        width: rpx(42),
        minHeight: rpx(24),
        alignItems: "center",
        justifyContent: "center",
    },
    alphabetIndexText: {
        includeFontPadding: false,
        textAlign: "center",
    },
    checkBoxWrapper: {
        height: "100%",
        justifyContent: "center",
        marginRight: rpx(16),
    },
    selectionHeader: {
        height: rpx(84),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    selectionHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    selectionTextButton: {
        paddingVertical: rpx(12),
        paddingLeft: rpx(28),
    },
    selectionSpacer: {
        height: rpx(144),
    },
    selectionBottomBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: rpx(144),
        flexDirection: "row",
        zIndex: 1001,
    },
    selectionAction: {
        flex: 1,
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
    },
    selectionActionText: {
        marginTop: rpx(10),
        paddingHorizontal: rpx(4),
        textAlign: "center",
    },
    disabledAction: {
        opacity: 0.6,
    },
});
