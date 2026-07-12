import SortableFlashList from "@/components/base/sortableFlashList";
import rpx from "@/utils/rpx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { StyleSheet, View } from "react-native";
import {
    editingMusicSheetAtom,
    IEditorMusicSheetItem,
    musicSheetChangedAtom,
    sheetEditorReadyAtom,
} from "../store/atom";
import React, { memo, useCallback, useMemo } from "react";
import { useI18N } from "@/core/i18n";
import TextButton from "@/components/base/textButton";
import { produce } from "immer";
import ListItem from "@/components/base/listItem";
import { ImgAsset } from "@/constants/assetsConst";
import { localPluginPlatform } from "@/constants/commonConst";
import Checkbox from "@/components/base/checkbox";
import useColors from "@/hooks/useColors";
import Empty from "@/components/base/empty";
import { useShortcutCardStyle } from "@/components/base/shortcutPageSurface";
import { getMediaUniqueKey } from "@/utils/mediaUtils";


interface ISheetEditorItemProps {
    index: number;
    editorMusicSheet: IEditorMusicSheetItem;
    editorReady: boolean;
}
function SheetEditorItemContent(props: ISheetEditorItemProps) {
    const { editorReady, index, editorMusicSheet } = props;
    const sheet = editorMusicSheet.musicSheetItem;
    const { t } = useI18N();
    const cardStyle = useShortcutCardStyle({
        compact: true,
        elevated: false,
    });

    const setEditingMusicSheet = useSetAtom(editingMusicSheetAtom);

    const onPress = useCallback(() => {
        if (!editorReady) {
            return;
        }
        setEditingMusicSheet(
            produce(draft => {
                draft[index].checked = !draft[index].checked;
            }),
        );
    }, [editorReady, index, setEditingMusicSheet]);

    const isLocalSheet = !(
        sheet.platform && sheet.platform !== localPluginPlatform
    );

    return (
        <ListItem
            heightType="big"
            withHorizontalPadding
            pressableStyle={cardStyle}
            style={styles.sheetItemContainer}
            onPress={onPress}
        >
            <View style={styles.checkBox}>
                <Checkbox checked={editorMusicSheet.checked} />
            </View>
            <ListItem.ListItemImage
                uri={sheet.coverImg ?? sheet.artwork}
                fallbackImg={ImgAsset.albumDefault}
            />
            <ListItem.Content
                title={sheet.title}
                description={
                    isLocalSheet
                        ? t("home.songCount", { count: sheet.worksNum })
                        : `${sheet.artist ?? ""}`
                }
            />
        </ListItem>
    );
}

const SheetEditorItem = memo(
    SheetEditorItemContent,
    (prev, curr) =>
        prev.editorMusicSheet === curr.editorMusicSheet &&
        prev.index === curr.index &&
        prev.editorReady === curr.editorReady,
);

export default function SheetList() {

    const { t } = useI18N();

    const [editingSheetList, setEditingMusicList] = useAtom(editingMusicSheetAtom);
    const setSheetChanged = useSetAtom(musicSheetChangedAtom);
    const editorReady = useAtomValue(sheetEditorReadyAtom);
    const selectedItemCount = useMemo(
        () => editingSheetList.reduce(
            (count, item) => count + (item.checked ? 1 : 0),
            0,
        ),
        [editingSheetList],
    );
    const colors = useColors();

    const renderItem = useCallback(
        ({ item, index }: { item: IEditorMusicSheetItem; index: number }) => (
            <SheetEditorItem
                index={index}
                editorMusicSheet={item}
                editorReady={editorReady}
            />
        ),
        [editorReady],
    );
    const keyExtractor = useCallback(
        (item: IEditorMusicSheetItem) =>
            getMediaUniqueKey(item.musicSheetItem),
        [],
    );
    const onSortEnd = useCallback((newData: IEditorMusicSheetItem[]) => {
        if (!editorReady) {
            return;
        }
        setEditingMusicList(newData);
        setSheetChanged(true);
    }, [editorReady, setEditingMusicList, setSheetChanged]);

    return (
        <>
            <View style={styles.header}>
                <TextButton
                    onPress={() => {
                        if (!editorReady) {
                            return;
                        }
                        if (
                            selectedItemCount !== editingSheetList.length &&
                            editingSheetList.length
                        ) {
                            setEditingMusicList(
                                editingSheetList.map(_ => ({
                                    musicSheetItem: _.musicSheetItem,
                                    checked: true,
                                })),
                            );
                        } else {
                            setEditingMusicList(
                                editingSheetList.map(_ => ({
                                    musicSheetItem: _.musicSheetItem,
                                    checked: false,
                                })),
                            );
                        }
                    }}>
                    {`${((selectedItemCount !== editingSheetList.length &&
                        editingSheetList.length) || !editingSheetList.length)
                        ? t("common.selectAll")
                        : t("common.unselectAll")
                    } (${t("musicSheetEditor.selectSheetCount", { count: selectedItemCount })})`}
                </TextButton>
            </View>
            {!editorReady || editingSheetList.length === 0 ? <Empty /> : <SortableFlashList
                activeBackgroundColor={colors.placeholder}
                data={editingSheetList}
                estimatedItemSize={rpx(132)}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                onSortEnd={onSortEnd}
            />}
        </>
    );
}


const styles = StyleSheet.create({
    checkBox: {
        height: "100%",
        justifyContent: "center",
        marginRight: rpx(24),
    },
    header: {
        flexDirection: "row",
        height: rpx(88),
        paddingHorizontal: rpx(24),
        alignItems: "center",
        justifyContent: "space-between",
    },
    sheetItemContainer: {
        paddingRight: rpx(100),
    },
});
