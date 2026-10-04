import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ThemeText from "./base/themeText";
import { FontScaleScope } from "./base/fontScaleScope";
import Icon from "./base/icon";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import { playbackRecovery } from "@/core/trackPlayer/playbackRecovery";
import { showPanel } from "./panels/usePanel";

/** Remains available until dismissed or another playback request starts. */
export default function PlaybackRecoveryNotice() {
    const notice = playbackRecovery.state.useValue();
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const { t } = useI18N();
    if (!notice) {
        return null;
    }
    return (
        <FontScaleScope followSystem>
            <View
                style={[
                    styles.container,
                    {
                        top: insets.top + 56,
                        left: insets.left + 12,
                        right: insets.right + 12,
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                    },
                ]}>
                <Pressable
                    style={styles.message}
                    accessibilityRole="button"
                    accessibilityLiveRegion="polite"
                    onPress={() => showPanel("PlaybackRecovery", { notice })}>
                    <ThemeText numberOfLines={1} fontWeight="semibold">
                        {t("playbackRecovery.title")}: {notice.musicItem.title}
                    </ThemeText>
                    <ThemeText fontColor="primary">
                        {t("playbackRecovery.actions")}
                    </ThemeText>
                </Pressable>
                <Pressable
                    style={styles.dismiss}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.cancel")}
                    onPress={() => playbackRecovery.dismiss(notice.id)}>
                    <Icon name="x-mark" size={22} color={colors.text} />
                </Pressable>
            </View>
        </FontScaleScope>
    );
}

const styles = StyleSheet.create({
    container: {
        position: "absolute",
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 8,
        zIndex: 101,
    },
    message: {
        flex: 1,
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 4,
    },
    dismiss: {
        width: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
    },
});
