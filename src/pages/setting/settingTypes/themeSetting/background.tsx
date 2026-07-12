import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import ListItem from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
// import pathConst from '@/constants/pathConst';
import Config, { useAppConfig } from "@/core/appConfig";
import ThemeCard from "./themeCard";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Theme from "@/core/theme";
import { useI18N } from "@/core/i18n";
import { showDialog } from "@/components/dialogs/useDialog";
import Toast from "@/utils/toast";

export default function Background() {
    const { t } = useI18N();

    const themeBackground = useAppConfig("theme.background");
    const themeSelectedTheme = useAppConfig("theme.selectedTheme");
    const frostedCustomBgFrost =
        useAppConfig("theme.frostedCustomBgFrost") ?? true;
    const musicBarLiquidGlass =
        useAppConfig("theme.musicBarLiquidGlass") ?? false;
    const theme = Theme.useTheme();

    const navigate = useNavigate();

    // const onCustomBgPress = async () => {
    //     try {
    //         const result = await launchImageLibrary({
    //             mediaType: 'photo',
    //         });
    //         const uri = result.assets?.[0].uri;
    //         if (!uri) {
    //             return;
    //         }

    //         const bgPath = `${pathConst.dataPath}background${uri.substring(
    //             uri.lastIndexOf('.'),
    //         )}`;
    //         await copyFile(uri, bgPath);
    //         Config.set(
    //             'setting.theme.background',
    //             `file://${bgPath}#${Date.now()}`,
    //         );

    //         const colorsResult = await ImageColors.getColors(uri, {
    //             fallback: '#ffffff',
    //         });
    //         const colors = {
    //             primary:
    //                 colorsResult.platform === 'android'
    //                     ? colorsResult.dominant
    //                     : colorsResult.platform === 'ios'
    //                     ? colorsResult.primary
    //                     : colorsResult.vibrant,
    //             average:
    //                 colorsResult.platform === 'android'
    //                     ? colorsResult.average
    //                     : colorsResult.platform === 'ios'
    //                     ? colorsResult.detail
    //                     : colorsResult.dominant,
    //             vibrant:
    //                 colorsResult.platform === 'android'
    //                     ? colorsResult.vibrant
    //                     : colorsResult.platform === 'ios'
    //                     ? colorsResult.secondary
    //                     : colorsResult.vibrant,
    //         };
    //         const primaryColor = Color(colors.primary).darken(0.3).toString();
    //         // const secondaryColor = Color(colors.average)
    //         //   .darken(0.3)
    //         //   .toString();
    //         const textHighlight = Color(
    //             0xffffff - Color(primaryColor).rgbNumber(),
    //             'rgb',
    //         )
    //             .saturate(0.5)
    //             .toString();
    //         Config.set('setting.theme.mode', 'custom-dark');
    //         Config.set('setting.theme.colors', {
    //             primary: primaryColor,
    //             textHighlight: textHighlight,
    //             accent: textHighlight,
    //         });
    //     } catch (e) {
    //         console.log(e);
    //     }
    // };

    return (
        <View>
            <ThemeText
                fontSize="subTitle"
                fontWeight="bold"
                style={style.header}>
                {t("themeSettings.setTheme")}
            </ThemeText>
            <View style={style.sectionWrapper}>
                <ThemeCard
                    preview="#fff"
                    title={t("themeSettings.lightMode")}
                    selected={themeSelectedTheme === "p-light"}
                    onPress={() => {
                        if (themeSelectedTheme !== "p-light") {
                            Theme.setTheme("p-light");
                            Config.setConfig("theme.followSystem", false);
                        }
                    }}
                />
                <ThemeCard
                    preview="#131313"
                    title={t("themeSettings.darkMode")}
                    selected={themeSelectedTheme === "p-dark"}
                    onPress={() => {
                        if (themeSelectedTheme !== "p-dark") {
                            Theme.setTheme("p-dark");
                            Config.setConfig("theme.followSystem", false);
                        }
                    }}
                />

                <ThemeCard
                    previewColors={[
                        "#cfdff2",
                        "#d8d5ee",
                        "#e8d9e6",
                        "#ffffff",
                    ]}
                    title={t("themeSettings.frostedGlassMode")}
                    selected={themeSelectedTheme === "p-frosted-glass"}
                    onPress={() => {
                        if (themeSelectedTheme !== "p-frosted-glass") {
                            Theme.setTheme("p-frosted-glass");
                            Config.setConfig("theme.followSystem", false);
                        }
                    }}
                />

                <ThemeCard
                    title={t("themeSettings.customMode")}
                    selected={themeSelectedTheme === "custom"}
                    preview={themeBackground}
                    onPress={() => {
                        if (themeSelectedTheme !== "custom") {
                            Config.setConfig("theme.followSystem", false);
                            Theme.setTheme("custom", {
                                colors: Config.getConfig(
                                    "theme.customColors",
                                ),
                            });
                        }
                        navigate(ROUTE_PATH.SET_CUSTOM_THEME);
                        // showPanel('ColorPicker');
                    }}
                />
            </View>
            {themeBackground ? (
                <ListItem
                    withHorizontalPadding
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
                    }}>
                    <ListItem.ListItemIcon
                        icon="trash-outline"
                        color={theme.colors.danger}
                    />
                    <ListItem.Content
                        title={t("themeSettings.removeCustomBackground")}
                        description={t(
                            "themeSettings.removeCustomBackground.desc",
                        )}
                    />
                    <ListItem.ListItemIcon
                        icon="chevron-right"
                        position="right"
                    />
                </ListItem>
            ) : null}
            {themeSelectedTheme === "p-frosted-glass" ? (
                <>
                    <ListItem withHorizontalPadding>
                        <ListItem.Content
                            title={t("themeSettings.frostedCustomBgFrost")}
                            description={t(
                                "themeSettings.frostedCustomBgFrost.desc",
                            )}
                        />
                        <ThemeSwitch
                            value={frostedCustomBgFrost}
                            onValueChange={value => {
                                Config.setConfig(
                                    "theme.frostedCustomBgFrost",
                                    value,
                                );
                            }}
                        />
                    </ListItem>
                    <ListItem withHorizontalPadding>
                        <ListItem.Content
                            title={t("themeSettings.musicBarLiquidGlass")}
                            description={t(
                                "themeSettings.musicBarLiquidGlass.desc",
                            )}
                        />
                        <ThemeSwitch
                            value={musicBarLiquidGlass}
                            onValueChange={value => {
                                Config.setConfig(
                                    "theme.musicBarLiquidGlass",
                                    value,
                                );
                            }}
                        />
                    </ListItem>
                </>
            ) : null}
        </View>
    );
}

const style = StyleSheet.create({
    header: {
        marginTop: rpx(36),
        paddingLeft: rpx(24),
    },
    sectionWrapper: {
        marginTop: rpx(28),
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: rpx(24),
    },
});
