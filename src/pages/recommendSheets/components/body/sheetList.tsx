import React, { memo, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { FlashList } from "@shopify/flash-list";
import useRecommendSheets from "../../hooks/useRecommendSheets";
import SheetItem, {
    SHEET_GRID_SIDE_PADDING,
} from "@/components/mediaItem/sheetItem";
import useOrientation from "@/hooks/useOrientation";
import ListEmpty from "@/components/base/listEmpty";
import ListFooter from "@/components/base/listFooter";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";

interface ISheetListProps {
    tag: ICommon.IUnique;
    pluginHash: string;
}

function SheetList(props: ISheetListProps) {
    const { tag, pluginHash } = props ?? {};

    const [query, sheets, status] = useRecommendSheets(pluginHash, tag);

    function renderItem({ item }: { item: IMusic.IMusicSheetItemBase }) {
        return (
            <SheetItem sheetInfo={item} pluginHash={pluginHash} />
        );
    }
    const orientation = useOrientation();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));

    const keyExtractor = useCallback(
        (item: any, i: number) => `${i}-${item.platform}-${item.id}`,
        [],
    );

    return (
        <FlashList
            ListEmptyComponent={<ListEmpty state={status} onRetry={query} />}
            ListFooterComponent={
                <>
                    {sheets.length ? (
                        <ListFooter state={status} onRetry={query} />
                    ) : null}
                    {musicBarBottomInset ? (
                        <View style={{ height: musicBarBottomInset }} />
                    ) : null}
                </>
            }
            onEndReached={() => {
                query();
            }}
            onEndReachedThreshold={0.1}
            numColumns={orientation === "vertical" ? 3 : 4}
            contentContainerStyle={styles.grid}
            renderItem={renderItem}
            data={sheets}
            keyExtractor={keyExtractor}
        />
    );
}

const styles = StyleSheet.create({
    grid: {
        paddingHorizontal: SHEET_GRID_SIDE_PADDING,
        paddingTop: 8,
    },
});

export default memo(SheetList);
