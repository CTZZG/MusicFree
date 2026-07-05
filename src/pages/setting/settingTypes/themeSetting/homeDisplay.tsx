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
    const hideHomeHeroCard = useAppConfig("theme.hideHomeHeroCard") ?? false;
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
                <ListItem.Content title={t("themeSettings.hideHomeHeroCard")} />
                <ThemeSwitch
                    value={hideHomeHeroCard}
                    onValueChange={value => {
                        Config.setConfig("theme.hideHomeHeroCard", value);
                    }}
                />
            </ListItem>
            <ListItem withHorizontalPadding>
                <ListItem.Content title={t("themeSettings.hideHomeOperations")} />
                <ThemeSwitch
                    value={hideHomeOperations}
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
