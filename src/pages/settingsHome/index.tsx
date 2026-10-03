import React from "react";
import {
    BackHandler,
    Image,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import deviceInfoModule from "react-native-device-info";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Icon from "@/components/base/icon.tsx";
import LargeTitleScrollView from "@/components/base/largeTitleScrollView";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { ImgAsset } from "@/constants/assetsConst";
import { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import { usePlugins } from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Theme from "@/core/theme";
import { checkUpdateAndShowResult } from "@/hooks/useCheckUpdate.ts";
import useColors from "@/hooks/useColors";
import forceExitApp from "@/utils/forceExitApp";
import { useScheduleCloseCountDown } from "@/utils/scheduleClose";
import timeformat from "@/utils/timeformat";

// 与设计稿一致的 iOS 系统色图标块
const TINT = {
    indigo: "#5856D6",
    gray: "#8E8E93",
    blue: "#007AFF",
    purple: "#AF52DE",
    teal: "#30B0C7",
    red: "#FF3B30",
    cyan: "#34AADC",
};

/** 应用卡片：图标、名称、版本，点一下检查更新 */
function AppCard() {
    const colors = useColors();
    const { t } = useI18N();
    const applicationName = deviceInfoModule.getApplicationName();
    const versionLine = t("settingsHome.versionLine", {
        version: deviceInfoModule.getVersion(),
    });

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${applicationName}，${versionLine}`}
            onPress={() => checkUpdateAndShowResult(true)}
            style={({ pressed }) => [
                styles.appCard,
                { backgroundColor: colors.card },
                pressed ? { backgroundColor: colors.listActive } : null,
            ]}>
            <Image source={ImgAsset.logo} style={styles.appIcon} />
            <View style={styles.appTexts}>
                <ThemeText
                    numberOfLines={1}
                    fontWeight="semibold"
                    style={styles.appName}>
                    {applicationName}
                </ThemeText>
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontColor="textSecondary">
                    {versionLine}
                </ThemeText>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textSecondary} />
        </Pressable>
    );
}

/** 定时关闭单独成行：倒计时每秒刷新，不连累整页重渲染 */
function ScheduleCloseRow() {
    const countDown = useScheduleCloseCountDown();
    const { t } = useI18N();

    return (
        <GroupedRow
            icon="alarm-outline"
            iconTint={TINT.indigo}
            title={t("sidebar.scheduleClose")}
            value={
                countDown
                    ? timeformat(countDown)
                    : t("settingsHome.scheduleClose.off")
            }
            accessory="chevron"
            onPress={() => showPanel("TimingClose")}
        />
    );
}

/** 设置标签：原侧边栏里的入口都收在这里 */
export default function SettingsHome() {
    const { t, getSupportedLanguages, getLanguage, setLanguage } = useI18N();
    const navigate = useNavigate();
    const theme = Theme.useTheme();
    const followSystem = useAppConfig("theme.followSystem") ?? true;
    const plugins = usePlugins();
    const applicationName = deviceInfoModule.getApplicationName();

    const appearance = followSystem
        ? t("themeSettings.appearance.system")
        : theme.dark
            ? t("themeSettings.darkMode")
            : t("themeSettings.lightMode");

    function openSetting(type: string) {
        navigate(ROUTE_PATH.SETTING, { type });
    }

    return (
        <LargeTitleScrollView title={t("common.setting")}>
            <View style={styles.cardWrapper}>
                <AppCard />
            </View>

            <GroupedSection
                title={t("settingsHome.section.common")}
                dividerInset={58}>
                <ScheduleCloseRow />
            </GroupedSection>

            <GroupedSection
                title={t("settingsHome.section.general")}
                dividerInset={58}>
                <GroupedRow
                    icon="cog-8-tooth"
                    iconTint={TINT.gray}
                    title={t("sidebar.basicSettings")}
                    accessory="chevron"
                    onPress={() => openSetting("basic")}
                />
                <GroupedRow
                    icon="t-shirt-outline"
                    iconTint={TINT.blue}
                    title={t("themeSettings.appearance")}
                    value={appearance}
                    accessory="chevron"
                    onPress={() => openSetting("theme")}
                />
                <GroupedRow
                    icon="language"
                    iconTint={TINT.gray}
                    title={t("sidebar.languageSettings")}
                    value={getLanguage().name}
                    accessory="chevron"
                    onPress={() => {
                        showDialog("RadioDialog", {
                            content: getSupportedLanguages().map(item => ({
                                title: item.name,
                                value: item.locale,
                                label: item.name,
                            })),
                            title: t("sidebar.languageSettings"),
                            onOk(value) {
                                setLanguage(value as string);
                            },
                            defaultSelected: getLanguage().locale,
                        });
                    }}
                />
            </GroupedSection>

            <GroupedSection
                title={t("settingsHome.section.pluginsAndData")}
                dividerInset={58}>
                <GroupedRow
                    icon="javascript"
                    iconTint={TINT.purple}
                    title={t("sidebar.pluginManagement")}
                    value={t("settingsHome.pluginCount", {
                        count: plugins.length,
                    })}
                    accessory="chevron"
                    onPress={() => openSetting("plugin")}
                />
                <GroupedRow
                    icon="circle-stack"
                    iconTint={TINT.teal}
                    title={t("sidebar.backupAndResume")}
                    accessory="chevron"
                    onPress={() => openSetting("backup")}
                />
                <GroupedRow
                    icon="musical-note"
                    iconTint={TINT.red}
                    title={t("lastfm.title")}
                    accessory="chevron"
                    onPress={() => openSetting("lastfm")}
                />
                {Platform.OS === "android" ? (
                    <GroupedRow
                        icon="shield-keyhole-outline"
                        iconTint={TINT.cyan}
                        title={t("sidebar.permissionManagement")}
                        accessory="chevron"
                        onPress={() => navigate(ROUTE_PATH.PERMISSIONS)}
                    />
                ) : null}
            </GroupedSection>

            <GroupedSection dividerInset={58}>
                <GroupedRow
                    icon="information-circle"
                    iconTint={TINT.gray}
                    title={`${t("common.about")} ${applicationName}`}
                    accessory="chevron"
                    onPress={() => openSetting("about")}
                />
            </GroupedSection>

            <GroupedSection>
                <GroupedRow
                    title={t("sidebar.backToDesktop")}
                    onPress={() => {
                        // 仅安卓生效
                        BackHandler.exitApp();
                    }}
                />
                <GroupedRow
                    title={t("sidebar.exitApp")}
                    destructive
                    onPress={() => forceExitApp()}
                />
            </GroupedSection>
        </LargeTitleScrollView>
    );
}

const styles = StyleSheet.create({
    cardWrapper: {
        marginTop: 16,
        marginHorizontal: 16,
    },
    appCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 14,
    },
    appIcon: {
        width: 60,
        height: 60,
        borderRadius: 14,
    },
    appTexts: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    appName: {
        fontSize: 20,
        lineHeight: 25,
    },
});
