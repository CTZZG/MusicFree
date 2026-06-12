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
import { FlatListProps, Pressable, StyleSheet, View } from "react-native";
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
    } = props;    
    const colors = useColors();
    const { t } = useI18N();
    const flashListRef = useRef<FlashListRef<IMusic.IMusicItem>>(null);
    const [showBadge, setShowBadge] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
        () => new Set(),
    );
    const [selectionAnchorIndex, setSelectionAnchorIndex] =
        useState<number | null>(null);
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const selectionMode = selectedKeys.size > 0;
    const canRemoveSelected = !!musicSheet?.id;

    // 查找高亮项的索引
    const highlightIndex = React.useMemo(() => {
        if (!highlightMusicItem || !musicList) return -1;
        return musicList.findIndex(item => isSameMediaItem(item, highlightMusicItem));
    }, [highlightMusicItem, musicList]);    
    
    // 处理滚动开始
    const handleScrollBegin = useCallback(() => {
        if (highlightIndex !== -1) {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
            setShowBadge(true);
        }
    }, [highlightIndex]);
    
    // 处理滚动结束
    const handleScrollEnd = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        // 5秒后直接隐藏
        hideTimeoutRef.current = setTimeout(() => {
            setShowBadge(false);
        }, 5000);
    }, []);    
    
    // 滚动到高亮项
    const scrollToHighlight = useCallback(() => {
        if (highlightIndex !== -1 && flashListRef.current) {
            flashListRef.current.scrollToIndex({
                index: highlightIndex,
                animated: false,
                viewPosition: 0,
            });
            // 立即隐藏角标
            setShowBadge(false);
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        }
    }, [highlightIndex]);    
    
    // 清理定时器
    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, []);    

    useEffect(() => {
        if (!musicList?.length) {
            setSelectedKeys(new Set());
            setSelectionAnchorIndex(null);
            return;
        }
        setSelectedKeys(prev => {
            const validKeys = new Set(musicList.map(item => getMediaUniqueKey(item)));
            const next = new Set([...prev].filter(key => validKeys.has(key)));
            if (!next.size) {
                setSelectionAnchorIndex(null);
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
                onScrollBeginDrag={handleScrollBegin}
                onScrollEndDrag={handleScrollEnd}
                onMomentumScrollEnd={handleScrollEnd}
                renderItem={({ index, item: musicItem }) => {
                    return (
                        <MusicItem
                            musicItem={musicItem}
                            index={showIndex ? index + 1 : undefined}
                            onItemPress={() => {
                                if (selectionMode) {
                                    toggleSelectionAt(index, musicItem);
                                } else if (onItemPress) {
                                    onItemPress(musicItem, musicList);
                                } else {
                                    TrackPlayer.playWithReplacePlayList(
                                        musicItem,
                                        musicList ?? [musicItem],
                                    );
                                }
                            }}
                            onItemLongPress={() => {
                                enterSelectionMode(index, musicItem);
                            }}
                            left={selectionMode
                                ? () => (
                                    <View style={styles.checkBoxWrapper}>
                                        <CheckBox
                                            checked={selectedKeys.has(
                                                getMediaUniqueKey(musicItem),
                                            )}
                                        />
                                    </View>
                                )
                                : undefined}
                            showMoreIcon={!selectionMode}
                            musicSheet={musicSheet}
                            highlight={isSameMediaItem(musicItem, highlightMusicItem)}
                        />
                    );
                }}
                onEndReached={() => {
                    if (state === RequestStateCode.IDLE || state === RequestStateCode.PARTLY_DONE) {
                        onLoadMore?.();
                    }
                }}
                onEndReachedThreshold={0.1}
            />              
            {showBadge && (
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
