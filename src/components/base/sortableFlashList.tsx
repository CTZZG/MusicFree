import globalStyle from "@/constants/globalStyle";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    LayoutChangeEvent,
    LayoutRectangle,
    NativeScrollEvent,
    NativeSyntheticEvent,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from "react-native";
import {
    Gesture,
    GestureDetector,
    GestureUpdateEvent,
    PanGestureHandlerEventPayload,
    Pressable,
    ScrollView,
} from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import Icon from "./icon";
import { iconSizeConst } from "@/constants/uiConst";
import useTextColor from "@/hooks/useTextColor";
import rpx from "@/utils/rpx";
import { useI18N } from "@/core/i18n";
import {
    getSortableAccessibilityTarget,
    getSortableAutoScrollOffset,
    getSortableDropIndex,
    isSortableIndex,
    moveSortableItem,
    updateSortableFrameStats,
} from "./sortableFlashListPolicy";
import useAccessibilityPreferences from "@/hooks/useAccessibilityPreferences";
import { devLog } from "@/utils/log";

/** 列表项容器 */
interface ISortableFlashListItemProps {
    index: number;
    totalCount?: number;
    startDrag?: (index: number) => void;
    moveItem?: (fromIndex: number, toIndex: number) => void;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    moveUpLabel?: string;
    moveDownLabel?: string;
    moveToTopLabel?: string;
    moveToBottomLabel?: string;
    touchDragEnabled?: boolean;
    hiddenFromAccessibility?: boolean;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    onLayout?: (event: LayoutChangeEvent) => void;
}

function SortableFlashListItem(props: ISortableFlashListItemProps) {
    const {
        index,
        totalCount = 0,
        children,
        startDrag,
        moveItem,
        accessibilityLabel,
        accessibilityHint,
        moveUpLabel,
        moveDownLabel,
        moveToTopLabel,
        moveToBottomLabel,
        touchDragEnabled = true,
        hiddenFromAccessibility = false,
        style,
        onLayout,
    } = props;

    const textColor = useTextColor();
    return (
        <Animated.View
            accessibilityElementsHidden={hiddenFromAccessibility}
            importantForAccessibility={
                hiddenFromAccessibility ? "no-hide-descendants" : "auto"
            }
            onLayout={onLayout}
            style={[listItemContainerStyle.container, style]}>
            {children}
            {startDrag && index >= 0 ? (
                <Pressable
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint={accessibilityHint}
                    accessibilityState={{
                        disabled: !moveItem || totalCount < 2,
                    }}
                    accessibilityValue={{
                        min: 1,
                        max: Math.max(totalCount, 1),
                        now: index + 1,
                    }}
                    accessibilityActions={[
                        ...(index > 0
                            ? [
                                {
                                    name: "decrement" as const,
                                    label: moveUpLabel,
                                },
                            ]
                            : []),
                        ...(index < totalCount - 1
                            ? [
                                {
                                    name: "increment" as const,
                                    label: moveDownLabel,
                                },
                            ]
                            : []),
                        ...(index > 0
                            ? [{
                                name: "moveToTop" as const,
                                label: moveToTopLabel,
                            }]
                            : []),
                        ...(index < totalCount - 1
                            ? [{
                                name: "moveToBottom" as const,
                                label: moveToBottomLabel,
                            }]
                            : []),
                    ]}
                    onAccessibilityAction={event => {
                        const target = getSortableAccessibilityTarget(
                            totalCount,
                            index,
                            event.nativeEvent.actionName,
                        );
                        if (target !== null) {
                            moveItem?.(index, target);
                        }
                    }}
                    style={listItemContainerStyle.dragHandle}
                    onTouchStart={() => {
                        if (touchDragEnabled) {
                            startDrag(index);
                        }
                    }}>
                    <Icon
                        name="bars-3"
                        size={iconSizeConst.normal}
                        color={textColor}
                    />
                </Pressable>
            ) : null}
        </Animated.View>
    );
}

const listItemContainerStyle = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
    },
    dragHandle: {
        position: "absolute",
        right: rpx(12),
        height: "100%",
        justifyContent: "center",
        paddingHorizontal: rpx(16),
        zIndex: 20,
    },
});


interface ISortableFlashListProps<T> {
    // 列表内部的数据
    data: T[];
    // 渲染每一行的函数
    renderItem: (props: { item: T; index: number }) => JSX.Element;
    // 排序结束时的回调函数
    onSortEnd?: (newData: T[]) => void;
    // 列表高度
    estimatedItemSize?: number;
    // 高亮元素样式
    activeBackgroundColor?: string;
    // 为虚拟列表提供稳定身份，避免数据源切换时按下标重建全部行
    keyExtractor?: (item: T, index: number) => string;
    // 读屏时优先使用业务实体名称，而不是只播报列表位置
    getItemAccessibilityLabel?: (item: T, index: number) => string;
}

// 高度应该固定，否则会有问题
export default function SortableFlashList<T extends any = any>(
    props: ISortableFlashListProps<T>,
) {
    const {
        data,
        renderItem,
        onSortEnd,
        estimatedItemSize,
        activeBackgroundColor,
        keyExtractor,
        getItemAccessibilityLabel,
    } = props;
    const { t } = useI18N();
    const { screenReaderEnabled } = useAccessibilityPreferences();

    const draggingIndexRef = useRef<number>(-1);
    const [dragging, setDragging] = useState(false);


    // 列表layout
    const [listLayout, setListLayout] = useState<LayoutRectangle | null>(null);
    const listLayoutReadyRef = useRef(false);

    // 选中元素位置
    const itemHeightValue = useSharedValue(estimatedItemSize || 0);
    const draggingElementOffsetValue = useSharedValue(-9999);

    // 自动滚动
    const listRef = useRef<FlashListRef<T>>(null);
    const scrollAnimationFrameRef = useRef<number | null>(null);
    const scrollFrameTimeRef = useRef<number | null>(null);
    const dragResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const frameStatsRef = useRef({
        frameCount: 0,
        slowFrameCount: 0,
        maxFrameMs: 0,
    });

    // 滚动位置
    const listOffsetRef = useRef(0);
    const listHeightRef = useRef(data.length * (estimatedItemSize || 0));


    const scrollHandler = useCallback((evt: NativeSyntheticEvent<NativeScrollEvent>) => {
        listOffsetRef.current = evt.nativeEvent.contentOffset.y;
    }, []);

    const contentSizeChangeHandler = useCallback((_: number, height: number) => {
        listHeightRef.current = height;
    }, []);

    useEffect(() => {
        if (!dragging || !listLayout) {
            return;
        }

        const scrollFrame = (timestamp: number) => {
            const elapsedMs = scrollFrameTimeRef.current === null
                ? 16
                : timestamp - scrollFrameTimeRef.current;
            scrollFrameTimeRef.current = timestamp;
            frameStatsRef.current = updateSortableFrameStats(
                frameStatsRef.current,
                elapsedMs,
            );
            const currentOffset = listOffsetRef.current;
            const nextOffset = getSortableAutoScrollOffset({
                draggingItemOffsetY: draggingElementOffsetValue.value,
                itemHeight: itemHeightValue.value,
                viewportHeight: listLayout.height,
                contentHeight: listHeightRef.current,
                currentOffset,
                elapsedMs,
            });
            if (nextOffset !== currentOffset && listRef.current) {
                listOffsetRef.current = nextOffset;
                listRef.current.scrollToOffset({
                    animated: false,
                    offset: nextOffset,
                });
            }
            scrollAnimationFrameRef.current = requestAnimationFrame(scrollFrame);
        };

        scrollFrameTimeRef.current = null;
        scrollAnimationFrameRef.current = requestAnimationFrame(scrollFrame);
        return () => {
            if (scrollAnimationFrameRef.current !== null) {
                cancelAnimationFrame(scrollAnimationFrameRef.current);
                scrollAnimationFrameRef.current = null;
            }
            scrollFrameTimeRef.current = null;
        };
    }, [
        dragging,
        draggingElementOffsetValue,
        itemHeightValue,
        listLayout,
    ]);

    useEffect(() => () => {
        if (dragResetTimerRef.current) {
            clearTimeout(dragResetTimerRef.current);
        }
    }, []);


    const startDrag = useCallback((index: number) => {
        if (screenReaderEnabled || data.length < 2) {
            return;
        }
        frameStatsRef.current = {
            frameCount: 0,
            slowFrameCount: 0,
            maxFrameMs: 0,
        };
        draggingElementOffsetValue.value = -9999;
        if (
            listLayoutReadyRef.current &&
            isSortableIndex(data.length, index)
        ) {
            draggingIndexRef.current = index;
            setDragging(true);
        }
    }, [data.length, draggingElementOffsetValue, screenReaderEnabled]);

    const moveItem = useCallback((fromIndex: number, toIndex: number) => {
        if (!onSortEnd) {
            return;
        }
        const newData = moveSortableItem(data, fromIndex, toIndex);
        if (!newData) {
            return;
        }
        const rawItemLabel = getItemAccessibilityLabel?.(
            data[fromIndex],
            fromIndex,
        );
        const customItemLabel =
            typeof rawItemLabel === "string" ? rawItemLabel.trim() : "";
        const itemLabel = customItemLabel ||
            t("common.sortableItem", {
                position: fromIndex + 1,
                total: data.length,
            });
        onSortEnd(newData);
        if (screenReaderEnabled) {
            AccessibilityInfo.announceForAccessibility(
                t("common.sortableItemMoved", {
                    item: itemLabel,
                    position: toIndex + 1,
                    total: data.length,
                }),
            );
        }
    }, [
        data,
        getItemAccessibilityLabel,
        onSortEnd,
        screenReaderEnabled,
        t,
    ]);

    const renderSortableItem = useCallback(
        ({ item, index }: { item: T; index: number }) => {
            const rawAccessibilityLabel =
                getItemAccessibilityLabel?.(item, index);
            const customAccessibilityLabel =
                typeof rawAccessibilityLabel === "string"
                    ? rawAccessibilityLabel.trim()
                    : "";
            const accessibilityLabel =
                customAccessibilityLabel ||
                t("common.sortableItem", {
                    position: index + 1,
                    total: data.length,
                });
            return (
                <SortableFlashListItem
                    index={index}
                    totalCount={data.length}
                    startDrag={onSortEnd ? startDrag : undefined}
                    moveItem={onSortEnd ? moveItem : undefined}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint={t("common.sortableItemHint")}
                    moveUpLabel={t("common.sortableMoveUp")}
                    moveDownLabel={t("common.sortableMoveDown")}
                    moveToTopLabel={t("common.sortableMoveToTop")}
                    moveToBottomLabel={t("common.sortableMoveToBottom")}
                    touchDragEnabled={!screenReaderEnabled && data.length > 1}
                    onLayout={(layoutEvent: LayoutChangeEvent) => {
                        const layout = layoutEvent.nativeEvent.layout;
                        itemHeightValue.value = layout.height;
                    }}>
                    {renderItem({ item, index })}
                </SortableFlashListItem>
            );
        },
        [
            data.length,
            getItemAccessibilityLabel,
            itemHeightValue,
            moveItem,
            onSortEnd,
            renderItem,
            startDrag,
            screenReaderEnabled,
            t,
        ],
    );

    const onUpdate = (evt: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
        // 移动高亮元素位置
        if (
            draggingIndexRef.current !== -1 &&
            listLayout &&
            itemHeightValue.value > 0
        ) {
            draggingElementOffsetValue.value = Math.min(
                Math.max(evt.y - itemHeightValue.value / 2, 0),
                Math.max(listLayout.height - itemHeightValue.value, 0),
            );
        }

    };

    const onEnd = () => {
        if (draggingIndexRef.current !== -1) {
            const fromIndex = draggingIndexRef.current;
            const toIndex = getSortableDropIndex({
                dataLength: data.length,
                itemHeight: itemHeightValue.value,
                scrollOffset: listOffsetRef.current,
                draggingItemOffsetY: draggingElementOffsetValue.value,
            });
            if (toIndex !== null) {
                moveItem(fromIndex, toIndex);
            }
        }
    };

    const onFinalize = () => {
        if (draggingIndexRef.current !== -1) {
            if (frameStatsRef.current.frameCount) {
                devLog("info", "sortable-list-drag-performance", {
                    ...frameStatsRef.current,
                    itemCount: data.length,
                });
            }
            draggingIndexRef.current = -1;
            setDragging(false);
            // 有线程导致的时序问题，延时执行
            if (dragResetTimerRef.current) {
                clearTimeout(dragResetTimerRef.current);
            }
            dragResetTimerRef.current = setTimeout(() => {
                draggingElementOffsetValue.value = -9999;
                dragResetTimerRef.current = null;
            }, 16);
        }
    };

    const gesture = Gesture.Pan()
        .enabled(
            !!listLayout &&
            !screenReaderEnabled &&
            !!onSortEnd &&
            data.length > 1,
        )
        .shouldCancelWhenOutside(false)
        .onUpdate(evt => {
            runOnJS(onUpdate)(evt);
        })
        .onEnd(() => {
            runOnJS(onEnd)();
        })
        .onFinalize(() => {
            runOnJS(onFinalize)();
        });

    // styles
    const draggingItemStyle = useAnimatedStyle(() => {
        return {
            top: draggingElementOffsetValue.value,
        };
    });
    const draggingIndex = draggingIndexRef.current;
    const shouldRenderDraggingItem =
        dragging && isSortableIndex(data.length, draggingIndex);
    return (
        <GestureDetector gesture={gesture}>
            <View
                style={globalStyle.fwflex1}
                onLayout={evt => {
                    setListLayout(evt.nativeEvent.layout);
                    listLayoutReadyRef.current = true;
                }}>
                {shouldRenderDraggingItem ? (
                    <SortableFlashListItem
                        index={-1}
                        hiddenFromAccessibility
                        style={[
                            listStyles.fakeDraggingItem,
                            { backgroundColor: activeBackgroundColor },
                            draggingItemStyle as StyleProp<ViewStyle>,
                        ]}>
                        {renderItem({
                            item: data[draggingIndex],
                            index: -1,
                        })}
                    </SortableFlashListItem>
                ) : null}
                <FlashList
                    ref={listRef}
                    data={data}
                    renderItem={renderSortableItem}
                    keyExtractor={keyExtractor}
                    drawDistance={(estimatedItemSize || rpx(120)) * 4}
                    scrollEnabled={!dragging}
                    scrollEventThrottle={16}
                    onScroll={scrollHandler}
                    onContentSizeChange={contentSizeChangeHandler}
                    renderScrollComponent={ScrollView}
                />
            </View>
        </GestureDetector>
    );
}


const listStyles = StyleSheet.create({
    fakeDraggingItem: {
        position: "absolute",
        zIndex: 1000,
        top: -9999,
        width: "100%",
    },
});
