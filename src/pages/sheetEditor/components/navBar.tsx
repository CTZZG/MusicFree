import AppBar from "@/components/base/appBar";
import { useAtomValue } from "jotai";
import {
    musicSheetChangedAtom,
    sheetEditorReadyAtom,
    sheetEditorSavingAtom,
    sheetTypeAtom,
} from "../store/atom";
import { useI18N } from "@/core/i18n";
import { Pressable, StyleSheet, View } from "react-native";
import { ILanguageData } from "@/types/core/i18n";
import ThemeText from "@/components/base/themeText";
import Divider from "@/components/base/divider";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import { Fragment, useMemo } from "react";
import IconButton from "@/components/base/iconButton";
import { beginSheetTypeChange } from "../store/action";
import {
    confirmSheetEditorTransition,
    saveEditingMusicSheetWithFeedback,
} from "../store/transition";


const tabs: Array<{
    key: "local" | "starred",
    i18nKey: keyof ILanguageData,
}> = [{
    key: "local",
    i18nKey: "home.myPlaylists",
}, {
    key: "starred",
    i18nKey: "home.starredPlaylists",
}];

export default function NavBar() {
    const sheetType = useAtomValue(sheetTypeAtom);

    const { t } = useI18N();
    const colors = useColors();
    const sheetChanged = useAtomValue(musicSheetChangedAtom);
    const isReady = useAtomValue(sheetEditorReadyAtom);
    const isSaving = useAtomValue(sheetEditorSavingAtom);
    
    const selectedIndicatorStyle = useMemo(() => {
        return [
            styles.selectedIndicator,
            {
                backgroundColor: colors.primary,
            },
        ];
    }, [colors]);

    return (
        <AppBar backgroundColor="transparent" spacious contentStyle={styles.navBarContentStyle}
            actionComponent={<IconButton
                name="save-outline"
                sizeType="normal"
                color={sheetChanged ? colors.primary : colors.text}
                opacity={sheetChanged ? 1 : 0.6}
                onPress={async () => {
                    if (sheetChanged && isReady && !isSaving) {
                        await saveEditingMusicSheetWithFeedback();
                    }
                }}
            />}
        >
            {tabs.map((tab, index) => (
                <Fragment key={tab.key}>
                    <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                            selected: sheetType === tab.key,
                            disabled: isSaving,
                        }}
                        disabled={isSaving}
                        hitSlop={rpx(12)}
                        style={styles.tab}
                        onPress={() => {
                            if (sheetType !== tab.key) {
                                confirmSheetEditorTransition(() => {
                                    beginSheetTypeChange(tab.key);
                                });
                            }
                        }}>
                        <ThemeText style={sheetType === tab.key ? styles.selectTabText : null}>{t(tab.i18nKey)}</ThemeText>
                        <View style={sheetType === tab.key ? selectedIndicatorStyle : null} />
                    </Pressable>

                    { index === 0 ? <Divider vertical style={styles.divider} /> : null}
                </Fragment>
            ))}
        </AppBar>
    );
}


const styles = StyleSheet.create({
    navBarContentStyle: {
        flexDirection: "row",
        justifyContent: "center",
        paddingVertical: rpx(12),
    },
    divider: {
        marginHorizontal: rpx(16),
        width: rpx(4),
        height: rpx(24),
    },
    tab: {
        minWidth: rpx(132),
        minHeight: rpx(56),
        alignItems: "center",
        justifyContent: "center",
    },
    selectTabText: {
        fontWeight: "bold",
    },
    selectedIndicator: {
        position: "absolute",
        bottom: -rpx(18),
        height: rpx(6),
        width: "100%",
    },
});
