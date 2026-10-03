import React from "react";
import ThemeSwitch from "@/components/base/switch";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";

export default function HomeDisplay() {
    const { t } = useI18N();
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;
    const hideHomeDiscovery = useAppConfig("theme.hideHomeDiscovery") ?? false;
    const hideHomeHeroCard = useAppConfig("theme.hideHomeHeroCard") ?? false;
    const hideHomeRecentListening =
        useAppConfig("theme.hideHomeRecentListening") ?? false;
    const hideHomeOperations = useAppConfig("theme.hideHomeOperations") ?? false;

    const switchRow = (
        title: string,
        value: boolean,
        onValueChange: (value: boolean) => void,
        subtitle?: string,
    ) => (
        <GroupedRow
            title={title}
            subtitle={subtitle}
            accessory={
                <ThemeSwitch
                    value={value}
                    accessibilityLabel={title}
                    onValueChange={onValueChange}
                />
            }
        />
    );

    return (
        <GroupedSection title={t("themeSettings.homeDisplay")}>
            {switchRow(
                t("themeSettings.useEnhancedHome"),
                useEnhancedHome,
                value => Config.setConfig("theme.useEnhancedHome", value),
                t("themeSettings.useEnhancedHome.desc"),
            )}
            {useEnhancedHome
                ? switchRow(
                    t("themeSettings.hideHomeDiscovery"),
                    hideHomeDiscovery,
                    value =>
                        Config.setConfig("theme.hideHomeDiscovery", value),
                )
                : null}
            {switchRow(
                t("themeSettings.hideHomeHeroCard"),
                hideHomeHeroCard,
                value => Config.setConfig("theme.hideHomeHeroCard", value),
            )}
            {switchRow(
                t("themeSettings.hideHomeRecentListening"),
                hideHomeRecentListening,
                value =>
                    Config.setConfig("theme.hideHomeRecentListening", value),
            )}
            {switchRow(
                t("themeSettings.hideHomeOperations"),
                hideHomeOperations,
                value => Config.setConfig("theme.hideHomeOperations", value),
            )}
        </GroupedSection>
    );
}
