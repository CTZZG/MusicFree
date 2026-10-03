import React from "react";
import { Appearance } from "react-native";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Config, { useAppConfig } from "@/core/appConfig";
import Theme from "@/core/theme";
import { themeIdForColorScheme } from "@/core/themeAppearance";
import { useI18N } from "@/core/i18n";

type AppearanceOption = "system" | "light" | "dark";

/** 外观：跟随系统、浅色、深色三选一 */
export default function Mode() {
    const { t } = useI18N();
    const followSystem = useAppConfig("theme.followSystem") ?? true;
    const theme = Theme.useTheme();

    const selected: AppearanceOption = followSystem
        ? "system"
        : theme.dark
            ? "dark"
            : "light";

    const select = (option: AppearanceOption) => {
        if (option === "system") {
            Config.setConfig("theme.followSystem", true);
            Theme.setTheme(
                themeIdForColorScheme(
                    Appearance.getColorScheme(),
                    theme.dark ? "p-dark" : "p-light",
                ),
            );
            return;
        }
        Config.setConfig("theme.followSystem", false);
        Theme.setTheme(option === "dark" ? "p-dark" : "p-light");
    };

    return (
        <GroupedSection title={t("themeSettings.appearance")}>
            <GroupedRow
                title={t("themeSettings.appearance.system")}
                accessory={selected === "system" ? "check" : "none"}
                onPress={() => select("system")}
            />
            <GroupedRow
                title={t("themeSettings.lightMode")}
                accessory={selected === "light" ? "check" : "none"}
                onPress={() => select("light")}
            />
            <GroupedRow
                title={t("themeSettings.darkMode")}
                accessory={selected === "dark" ? "check" : "none"}
                onPress={() => select("dark")}
            />
        </GroupedSection>
    );
}
