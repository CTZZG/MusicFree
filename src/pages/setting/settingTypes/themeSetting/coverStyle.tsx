import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";

export default function CoverStyle() {
    const { t } = useI18N();
    const colors = useColors();
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";

    return (
        <View>
            <ThemeText
                fontSize="subTitle"
                fontWeight="bold"
                style={styles.header}>
                {t("themeSettings.coverStyle")}
            </ThemeText>
            <ListItem withHorizontalPadding>
                <ListItem.Content>
                    <View style={styles.optionsRow}>
                        <TouchableOpacity
                            style={[
                                styles.optionItem,
                                coverStyle === "square" && {
                                    borderColor: colors.primary,
                                },
                            ]}
                            onPress={() => {
                                Config.setConfig("theme.coverStyle", "square");
                            }}>
                            <View
                                style={[
                                    styles.previewSquare,
                                    { backgroundColor: colors.card },
                                ]}
                            />
                            <ThemeText
                                fontSize="description"
                                style={styles.optionText}>
                                {t("themeSettings.coverStyleSquare")}
                            </ThemeText>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.optionItem,
                                coverStyle === "circle" && {
                                    borderColor: colors.primary,
                                },
                            ]}
                            onPress={() => {
                                Config.setConfig("theme.coverStyle", "circle");
                            }}>
                            <View
                                style={[
                                    styles.previewCircle,
                                    { backgroundColor: colors.card },
                                ]}
                            />
                            <ThemeText
                                fontSize="description"
                                style={styles.optionText}>
                                {t("themeSettings.coverStyleCircle")}
                            </ThemeText>
                        </TouchableOpacity>
                    </View>
                </ListItem.Content>
            </ListItem>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingLeft: rpx(24),
        marginTop: rpx(36),
        marginBottom: rpx(12),
    },
    optionsRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
    },
    optionItem: {
        alignItems: "center",
        padding: rpx(16),
        borderRadius: rpx(12),
        borderWidth: 2,
        borderColor: "transparent",
    },
    previewSquare: {
        width: rpx(80),
        height: rpx(80),
        borderRadius: rpx(12),
    },
    previewCircle: {
        width: rpx(80),
        height: rpx(80),
        borderRadius: rpx(40),
    },
    optionText: {
        marginTop: rpx(12),
    },
});
