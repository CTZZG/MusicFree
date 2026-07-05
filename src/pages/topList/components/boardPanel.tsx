import React, { memo, useMemo } from "react";
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from "react-native";
import rpx from "@/utils/rpx";
import { IPluginTopListResult } from "../store/atoms";
import { RequestStateCode } from "@/constants/commonConst";
import Loading from "@/components/base/loading";
import TopListItem from "@/components/mediaItem/topListItem";
import ThemeText from "@/components/base/themeText";
import ListEmpty from "@/components/base/listEmpty";
import useColors from "@/hooks/useColors";
import useOrientation from "@/hooks/useOrientation";
import { resolveTopListGridLayout } from "./topListGridLayout";

const HORIZONTAL_PADDING = rpx(24);
const COLUMN_GAP = rpx(16);
const MIN_CARD_WIDTH = 140;

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
    const requestState =
        topListData?.state ?? RequestStateCode.PENDING_FIRST_PAGE;
    const isLoading =
        requestState === RequestStateCode.LOADING ||
        requestState === RequestStateCode.PENDING_REST_PAGE;
    const hasExistingData = !!topListData?.data?.length;
    const isRefreshing = isLoading && hasExistingData;
    const sections = topListData?.data || [];
    const gridLayout = useMemo(
        () =>
            resolveTopListGridLayout({
                containerWidth: windowWidth,
                orientation,
                horizontalPadding: HORIZONTAL_PADDING,
                columnGap: COLUMN_GAP,
                minCardWidth: MIN_CARD_WIDTH,
            }),
        [orientation, windowWidth],
    );

    return isLoading && !hasExistingData ? (
        <Loading />
    ) : (
        <ScrollView
            contentContainerStyle={style.contentContainer}
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
                sections.map(section => (
                    <View key={section.title} style={style.section}>
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
                                            width: gridLayout.itemWidth,
                                            marginRight:
                                                (index + 1) %
                                                    gridLayout.columnCount ===
                                                0
                                                    ? 0
                                                    : COLUMN_GAP,
                                        },
                                    ]}>
                                    <TopListItem
                                        topListItem={item}
                                        pluginHash={hash}
                                        rank={index + 1}
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
        paddingHorizontal: HORIZONTAL_PADDING,
        paddingTop: rpx(8),
        paddingBottom: rpx(36),
    },
    section: {
        width: "100%",
    },
    sectionHeader: {
        marginTop: rpx(28),
        marginBottom: rpx(16),
    },
    grid: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
    },
    gridItem: {
        marginBottom: COLUMN_GAP,
        flexShrink: 0,
    },
});
