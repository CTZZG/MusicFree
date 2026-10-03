import React from "react";
import ThemeSwitch from "@/components/base/switch";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import { isLiquidGlassAvailable } from "@/components/base/liquidGlassBackdrop";
import Config, { useAppConfig } from "@/core/appConfig";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Theme from "@/core/theme";
import { useI18N } from "@/core/i18n";
import { showDialog } from "@/components/dialogs/useDialog";
import Toast from "@/utils/toast";

/** 首页背景图片与播放条材质 */
export default function Background() {
    const { t } = useI18N();
    const background = Theme.useBackground();
    const musicBarLiquidGlass =
        useAppConfig("theme.musicBarLiquidGlass") ?? false;
    const navigate = useNavigate();
    const hasBackground = !!background?.url;

    return (
        <>
            <GroupedSection footer={t("themeSettings.homeBackground.footer")}>
                <GroupedRow
                    title={t("themeSettings.homeBackground")}
                    value={
                        hasBackground
                            ? t("themeSettings.homeBackground.on")
                            : t("themeSettings.homeBackground.off")
                    }
                    accessory="chevron"
                    onPress={() => {
                        navigate(ROUTE_PATH.SET_CUSTOM_THEME);
                    }}
                />
                {hasBackground ? (
                    <GroupedRow
                        title={t("themeSettings.removeCustomBackground")}
                        destructive
                        onPress={() => {
                            showDialog("SimpleDialog", {
                                title: t("themeSettings.removeCustomBackground"),
                                content: t(
                                    "themeSettings.removeCustomBackground.confirm",
                                ),
                                onOk() {
                                    Theme.clearBackground();
                                    Toast.success(
                                        t(
                                            "themeSettings.removeCustomBackground.success",
                                        ),
                                    );
                                },
                            });
                        }}
                    />
                ) : null}
            </GroupedSection>
            {isLiquidGlassAvailable() ? (
                <GroupedSection>
                    <GroupedRow
                        title={t("themeSettings.musicBarLiquidGlass")}
                        subtitle={t("themeSettings.musicBarLiquidGlass.desc")}
                        accessory={
                            <ThemeSwitch
                                value={musicBarLiquidGlass}
                                accessibilityLabel={t(
                                    "themeSettings.musicBarLiquidGlass",
                                )}
                                onValueChange={value => {
                                    Config.setConfig(
                                        "theme.musicBarLiquidGlass",
                                        value,
                                    );
                                }}
                            />
                        }
                    />
                </GroupedSection>
            ) : null}
        </>
    );
}
