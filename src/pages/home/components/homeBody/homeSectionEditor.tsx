import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import ThemeText from "@/components/base/themeText";
import {
    defaultHomeOrder,
    moveHomeSection,
    normalizeHomeOrder,
} from "./homeSectionOrder";

/** Used by the home shortcut and the existing theme settings, with one persisted order. */
export default function HomeSectionEditor() {
    const { t } = useI18N();
    const enhanced = useAppConfig("theme.useEnhancedHome") ?? true;
    const saved = useAppConfig("theme.homeSectionOrder");
    const order = normalizeHomeOrder(saved, enhanced);
    return (
        <View style={styles.content}>
            <ThemeText fontColor="textSecondary">{t("homeOrder.description")}</ThemeText>
            {order.map((section, index) => (
                <View key={section} style={styles.row}>
                    <ThemeText style={styles.label}>
                        {t(`homeOrder.${section}`)}
                    </ThemeText>
                    {([-1, 1] as const).map(delta => {
                        const disabled =
                            index + delta < 0 || index + delta >= order.length;
                        const label = t(delta < 0 ? "homeOrder.up" : "homeOrder.down", {
                            title: t(`homeOrder.${section}`),
                        });
                        return (
                            <Pressable
                                key={delta}
                                accessibilityRole="button"
                                accessibilityLabel={label}
                                accessibilityState={{ disabled }}
                                disabled={disabled}
                                onPress={() =>
                                    Config.setConfig(
                                        "theme.homeSectionOrder",
                                        moveHomeSection(order, section, delta),
                                    )
                                }
                                style={[
                                    styles.button,
                                    disabled ? styles.disabled : null,
                                ]}>
                                <ThemeText fontSize="title">
                                    {delta < 0 ? "↑" : "↓"}
                                </ThemeText>
                            </Pressable>
                        );
                    })}
                </View>
            ))}
            <Pressable
                style={styles.reset}
                accessibilityRole="button"
                accessibilityLabel={t("homeOrder.reset")}
                onPress={() =>
                    Config.setConfig("theme.homeSectionOrder", defaultHomeOrder(enhanced))
                }>
                <ThemeText fontColor="primary">{t("homeOrder.reset")}</ThemeText>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16 },
    row: { flexDirection: "row", alignItems: "center", minHeight: 52 },
    label: { flex: 1 },
    button: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
    disabled: { opacity: 0.25 },
    reset: { paddingVertical: 16 },
});
