import React, { memo } from "react";
import {
    RefreshControl,
    SectionList,
    SectionListProps,
    StyleSheet,
    View,
} from "react-native";
import rpx from "@/utils/rpx";
import { IPluginTopListResult } from "../store/atoms";
import { RequestStateCode } from "@/constants/commonConst";
import Loading from "@/components/base/loading";
import TopListItem from "@/components/mediaItem/topListItem";
import ThemeText from "@/components/base/themeText";
import ListEmpty from "@/components/base/listEmpty";
import useColors from "@/hooks/useColors";

interface IBoardPanelProps {
    hash: string;
    topListData?: IPluginTopListResult;
    onRefresh?: () => void;
}
function BoardPanel(props: IBoardPanelProps) {
    const { hash, topListData, onRefresh } = props ?? {};
    const colors = useColors();
    const requestState =
        topListData?.state ?? RequestStateCode.PENDING_FIRST_PAGE;
    const isLoading =
        requestState === RequestStateCode.LOADING ||
        requestState === RequestStateCode.PENDING_REST_PAGE;
    const hasExistingData = !!topListData?.data?.length;
    const isRefreshing = isLoading && hasExistingData;

    const renderItem: SectionListProps<IMusic.IMusicSheetItemBase>["renderItem"] =
        ({ item }) => {
            return <TopListItem topListItem={item} pluginHash={hash} />;
        };

    const renderSectionHeader: SectionListProps<IMusic.IMusicSheetItemBase>["renderSectionHeader"] =
        ({ section: { title } }) => {
            return (
                <View style={style.sectionHeader}>
                    <ThemeText fontWeight="bold" fontSize="title">
                        {title}
                    </ThemeText>
                </View>
            );
        };

    return isLoading && !hasExistingData ? (
        <Loading />
    ) : (
        <SectionList
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            ListEmptyComponent={
                <ListEmpty state={requestState} onRetry={onRefresh} />
            }
            refreshControl={
                onRefresh ? (
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                ) : undefined
            }
            sections={topListData?.data || []}
        />
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
    wrapper: {
        width: rpx(750),
    },
    sectionHeader: {
        marginTop: rpx(28),
        marginBottom: rpx(24),
        marginLeft: rpx(24),
    },
});
