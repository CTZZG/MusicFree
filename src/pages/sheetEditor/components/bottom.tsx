import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import { iconSizeConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { StyleSheet } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import {
    editingMusicSheetAtom,
    musicSheetChangedAtom,
    sheetEditorReadyAtom,
} from "../store/atom";
import { useCallback, useMemo } from "react";

export default function Bottom() {
    const colors = useColors();
    const { t } = useI18N();
    const [editingMusicSheet, setEditingMusicSheet] = useAtom(editingMusicSheetAtom);
    const setMusicSheetChanged = useSetAtom(musicSheetChangedAtom);
    const editorReady = useAtomValue(sheetEditorReadyAtom);

    const selectedEditorItems = useMemo(() => editingMusicSheet.filter(_ => _.checked), [editingMusicSheet]);
    const selectedItems = useMemo(() => selectedEditorItems.map(_ => _.musicSheetItem), [selectedEditorItems]);


    const onPress = useCallback(() => {
        if (!editorReady || selectedItems.length === 0) {
            // 没有选中任何项，直接返回
            return;
        }

        setEditingMusicSheet(
            prev => prev.filter(it => !it.checked),
        );
        setMusicSheetChanged(true);
    }, [
        editorReady,
        selectedItems,
        setEditingMusicSheet,
        setMusicSheetChanged,
    ]);


    const isSelected = editorReady && selectedItems.length > 0;

    return (
        <Pressable style={[styles.bottomContainer, {
            borderTopColor: colors.divider,
        }]} 
        onPress={onPress} >
            <Icon name='trash-outline' size={iconSizeConst.big} color={colors.appBarText} style={isSelected ? null : styles.opacityButton} onPress={onPress}/>
            <ThemeText fontSize="subTitle" fontColor='appBarText' style={isSelected ? null : styles.opacityButton}>{t("common.delete")}</ThemeText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    bottomContainer: {
        height: rpx(144),
        alignItems: "center",
        justifyContent: "center",
        gap: rpx(12),
        backgroundColor: "transparent",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    opacityButton: {
        opacity: 0.6,
    },
});
