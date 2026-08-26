import React from "react";
import { StyleSheet, View } from "react-native";
import ListItem from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";

export default function HomeDisplay() {
    const { t } = useI18N();
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;
    const hideHomeDiscovery = useAppConfig("theme.hideHomeDiscovery") ?? false;
    const hideHomeHeroCard = useAppConfig("theme.hideHomeHeroCard") ?? false;
    const hideHomeRecentListening =
        useAppConfig("theme.hideHomeRecentListening") ?? false;
    const hideHomeOperations = useAppConfig("theme.hideHomeOperations") ?? false;

    return (
        <View>
            <ThemeText
                fontSize="subTitle"
                fontWeight="bold"
                style={styles.header}>
                {t("themeSettings.homeDisplay")}
            </ThemeText>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("themeSettings.useEnhancedHome")}
                    description={t("themeSettings.useEnhancedHome.desc")}
                />
                <ThemeSwitch
                    value={useEnhancedHome}
                    accessibilityLabel={t("themeSettings.useEnhancedHome")}
                    onValueChange={value => {
                        Config.setConfig("theme.useEnhancedHome", value);
                    }}
                />
            </ListItem>
            {useEnhancedHome ? (
                <ListItem withHorizontalPadding>
                    <ListItem.Content
                        title={t("themeSettings.hideHomeDiscovery")}
                    />
                    <ThemeSwitch
                        value={hideHomeDiscovery}
                        accessibilityLabel={t(
                            "themeSettings.hideHomeDiscovery",
                        )}
                        onValueChange={value => {
                            Config.setConfig("theme.hideHomeDiscovery", value);
                        }}
                    />
                </ListItem>
            ) : null}
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("themeSettings.hideHomeHeroCard")}
                />
                <ThemeSwitch
                    value={hideHomeHeroCard}
                    accessibilityLabel={t("themeSettings.hideHomeHeroCard")}
                    onValueChange={value => {
                        Config.setConfig("theme.hideHomeHeroCard", value);
                    }}
                />
            </ListItem>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("themeSettings.hideHomeRecentListening")}
                />
                <ThemeSwitch
                    value={hideHomeRecentListening}
                    accessibilityLabel={t(
                        "themeSettings.hideHomeRecentListening",
                    )}
                    onValueChange={value => {
                        Config.setConfig(
                            "theme.hideHomeRecentListening",
                            value,
                        );
                    }}
                />
            </ListItem>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("themeSettings.hideHomeOperations")}
                />
                <ThemeSwitch
                    value={hideHomeOperations}
                    accessibilityLabel={t("themeSettings.hideHomeOperations")}
                    onValueChange={value => {
                        Config.setConfig("theme.hideHomeOperations", value);
                    }}
                />
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
});
