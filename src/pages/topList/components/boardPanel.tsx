import React, { memo, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
    LayoutChangeEvent,
} from "react-native";
import { IPluginTopListResult } from "../store/atoms";
import { RequestStateCode } from "@/constants/commonConst";
import Loading from "@/components/base/loading";
import TopListItem, { getTopListPreview } from "@/components/mediaItem/topListItem";
import ThemeText from "@/components/base/themeText";
import ListEmpty from "@/components/base/listEmpty";
import useColors from "@/hooks/useColors";
import useOrientation from "@/hooks/useOrientation";
import { resolveTopListGridLayout } from "./topListGridLayout";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { PAGE_MARGIN, TILE_GAP } from "@/utils/tileLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MIN_CARD_WIDTH = 92;

interface IBoardPanelProps {
    hash: string;
    topListData?: IPluginTopListResult;
    onRefresh?: () => void;
}
function BoardPanel(props: IBoardPanelProps) {
    const { hash, topListData, onRefresh } = props ?? {};
    const colors = useColors();
    const orientation = useOrientation();
    const { width: windowWidth } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [measurement, setMeasurement] = useState<{
        windowWidth: number;
        width: number;
    }>();
    const musicBarBottomInset = useMusicBarFloatingOffset(16);
    const requestState =
        topListData?.state ?? RequestStateCode.PENDING_FIRST_PAGE;
    const isLoading =
        requestState === RequestStateCode.LOADING ||
        requestState === RequestStateCode.PENDING_REST_PAGE;
    const hasExistingData = !!topListData?.data?.length;
    const isRefreshing = isLoading && hasExistingData;
    const sections = topListData?.data || [];
    const gridLayout = resolveTopListGridLayout({
        containerWidth: measurement?.windowWidth === windowWidth
            ? measurement.width
            : windowWidth - insets.left - insets.right,
        orientation,
        horizontalPadding: PAGE_MARGIN,
        columnGap: TILE_GAP,
        minCardWidth: MIN_CARD_WIDTH,
    });
    const onLayout = (event: LayoutChangeEvent) => {
        setMeasurement({ windowWidth, width: event.nativeEvent.layout.width });
    };

    return isLoading && !hasExistingData ? (
        <Loading />
    ) : (
        <ScrollView
            onLayout={onLayout}
            contentContainerStyle={[
                style.contentContainer,
                { paddingBottom: musicBarBottomInset || 16 },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
                onRefresh ? (
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                ) : undefined
            }>
            {!sections.length ? (
                <ListEmpty state={requestState} onRetry={onRefresh} />
            ) : (
                sections.map((section, sectionIndex) => (
                    <View
                        key={`${section.title}-${sectionIndex}`}
                        style={[style.section, sectionIndex > 0 ? style.nextSection : null]}>
                        <View style={style.sectionHeader}>
                            <ThemeText fontWeight="bold" fontSize="title">
                                {section.title}
                            </ThemeText>
                        </View>
                        <View style={style.grid}>
                            {(section.data ?? []).map((item, index) => (
                                <View
                                    key={`${item.platform}-${item.id}-${item.title}`}
                                    style={[
                                        style.gridItem,
                                        {
                                            width: getTopListPreview(item).length
                                                ? gridLayout.availableWidth
                                                : gridLayout.itemWidth,
                                        },
                                    ]}>
                                    <TopListItem
                                        topListItem={item}
                                        pluginHash={hash}
                                        tintIndex={index}
                                    />
                                </View>
                            ))}
                        </View>
                    </View>
                ))
            )}
        </ScrollView>
    );
}

export default memo(
    BoardPanel,
    (prev, curr) =>
        prev.hash === curr.hash &&
        prev.topListData === curr.topListData &&
        prev.onRefresh === curr.onRefresh,
);

const style = StyleSheet.create({
    contentContainer: {
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: 16,
    },
    section: {
        width: "100%",
    },
    nextSection: {
        marginTop: 24,
    },
    sectionHeader: {
        marginBottom: 12,
    },
    grid: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: TILE_GAP,
    },
    gridItem: {
        flexShrink: 0,
    },
});
