import { IIconName } from "@/components/base/icon.tsx";
import ListItem from "@/components/base/listItem";
import PageBackground from "@/components/base/pageBackground";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { checkUpdateAndShowResult } from "@/hooks/useCheckUpdate.ts";
import forceExitApp from "@/utils/forceExitApp";
import rpx from "@/utils/rpx";
import { useScheduleCloseCountDown } from "@/utils/scheduleClose";
import timeformat from "@/utils/timeformat";
import useColors, { CustomizedColors } from "@/hooks/useColors";
import { DrawerContentScrollView } from "@react-navigation/drawer";
import React, { memo, ReactNode } from "react";
import { BackHandler, Platform, StyleSheet, View } from "react-native";
import deviceInfoModule from "react-native-device-info";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ISettingOptions {
    key: string;
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

interface IDrawerMenuItemProps {
    icon: IIconName;
    title: string;
    value?: string;
    valueColor?: keyof CustomizedColors;
    onPress?: () => void;
}

function DrawerMenuItem(props: IDrawerMenuItemProps) {
    const { icon, title, value, valueColor = "textSecondary", onPress } = props;

    return (
        <ListItem
            withHorizontalPadding
            heightType="normal"
            style={style.menuItem}
            onPress={onPress}>
            <ListItem.ListItemIcon icon={icon} width={rpx(48)} fixedWidth />
            <ListItem.Content title={title} />
            {value ? (
                <ListItem.ListItemText
                    position="right"
                    fontSize="description"
                    fontColor={valueColor}
                    containerStyle={style.itemValue}
                    contentProps={{ numberOfLines: 1 }}>
                    {value}
                </ListItem.ListItemText>
            ) : null}
        </ListItem>
    );
}

function DrawerSection(props: {title: string; children: ReactNode}) {
    const colors = useColors();

    return (
        <View
            style={[
                style.sectionCard,
                {
                    backgroundColor: colors.card ?? colors.backdrop,
                    borderColor: colors.divider,
                },
            ]}>
            <View style={style.sectionHeader}>
                <ThemeText fontSize="subTitle" fontWeight="bold">
                    {props.title}
                </ThemeText>
            </View>
            {props.children}
        </View>
    );
}

function HomeDrawer(props: any) {
    const navigate = useNavigate();
    const colors = useColors();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));
    const safeAreaInsets = useSafeAreaInsets();
    const closeDrawer = () => props.navigation?.closeDrawer?.();
    function navigateToSetting(settingType: string) {
        closeDrawer();
        navigate(ROUTE_PATH.SETTING, {
            type: settingType,
        });
    }

    const { t, getSupportedLanguages, getLanguage, setLanguage } = useI18N();
    const applicationName = deviceInfoModule.getApplicationName();
    const currentVersion = `${t("sidebar.currentVersion")}${deviceInfoModule.getVersion()}`;

    const basicSetting: ISettingOptions[] = [
        {
            key: "basic",
            icon: "cog-8-tooth",
            title: t("sidebar.basicSettings"),
            onPress: () => {
                navigateToSetting("basic");
            },
        },
        {
            key: "plugin",
            icon: "javascript",
            title: t("sidebar.pluginManagement"),
            onPress: () => {
                navigateToSetting("plugin");
            },
        },
        {
            key: "theme",
            icon: "t-shirt-outline",
            title: t("sidebar.themeSettings"),
            onPress: () => {
                navigateToSetting("theme");
            },
        },
        {
            key: "equalizer",
            icon: "bars-3",
            title: t("sidebar.equalizer"),
            onPress: () => {
                navigateToSetting("equalizer");
            },
        },
    ];

    const otherSetting: ISettingOptions[] = [
        {
            key: "backup",
            icon: "circle-stack",
            title: t("sidebar.backupAndResume"),
            onPress: () => {
                navigateToSetting("backup");
            },
        },
    ];

    if (Platform.OS === "android") {
        otherSetting.push({
            key: "permissions",
            icon: "shield-keyhole-outline",
            title: t("sidebar.permissionManagement"),
            onPress: () => {
                closeDrawer();
                navigate(ROUTE_PATH.PERMISSIONS);
            },
        });
    }

    return (
        <>
            <PageBackground />
            <DrawerContentScrollView
                {...props}
                style={[props.style, style.scrollWrapper]}
                contentContainerStyle={[
                    props.contentContainerStyle,
                    style.scrollContent,
                    {
                        paddingBottom: Math.max(
                            musicBarBottomInset,
                            safeAreaInsets.bottom + rpx(24),
                        ),
                    },
                ]}>
                <View style={style.brandHeader}>
                    <View
                        style={[
                            style.brandAccent,
                            { backgroundColor: colors.primary },
                        ]}
                    />
                    <ThemeText fontWeight="bold" style={style.brandName}>
                        {applicationName}
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        style={style.brandSubtitle}>
                        LIBRARY / PLAYER
                    </ThemeText>
                </View>
                <DrawerSection title={t("common.setting")}>
                    {basicSetting.map(item => (
                        <DrawerMenuItem
                            key={item.key}
                            icon={item.icon}
                            title={item.title}
                            onPress={item.onPress}
                        />
                    ))}
                </DrawerSection>
                <DrawerSection title={t("common.other")}>
                    <CountDownItem />
                    {otherSetting.map(item => (
                        <DrawerMenuItem
                            key={item.key}
                            icon={item.icon}
                            title={item.title}
                            onPress={item.onPress}
                        />
                    ))}
                    <DrawerMenuItem
                        icon="language"
                        title={t("sidebar.languageSettings")}
                        value={getLanguage().name}
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
                </DrawerSection>

                <DrawerSection title={t("common.software")}>
                    <DrawerMenuItem
                        icon="arrow-path"
                        title={t("sidebar.checkUpdate")}
                        value={currentVersion}
                        onPress={() => checkUpdateAndShowResult(true)}
                    />
                    <DrawerMenuItem
                        icon="information-circle"
                        title={`${t("common.about")} ${applicationName}`}
                        onPress={() => navigateToSetting("about")}
                    />
                </DrawerSection>

                <View
                    style={[
                        style.actionCard,
                        {
                            backgroundColor: colors.card ?? colors.backdrop,
                            borderColor: colors.divider,
                        },
                    ]}>
                    <DrawerMenuItem
                        icon="home-outline"
                        title={t("sidebar.backToDesktop")}
                        onPress={() => {
                            // 仅安卓生效
                            BackHandler.exitApp();
                        }}
                    />
                    <DrawerMenuItem
                        icon="power-outline"
                        title={t("sidebar.exitApp")}
                        onPress={() => forceExitApp()}
                    />
                </View>
            </DrawerContentScrollView>
        </>
    );
}

export default memo(HomeDrawer);

const style = StyleSheet.create({
    scrollWrapper: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: rpx(20),
    },
    brandHeader: {
        alignItems: "flex-start",
        paddingHorizontal: rpx(12),
        paddingTop: rpx(36),
        paddingBottom: rpx(32),
    },
    brandAccent: {
        width: rpx(40),
        height: rpx(6),
        borderRadius: rpx(3),
        marginBottom: rpx(16),
    },
    brandName: {
        fontSize: rpx(44),
        lineHeight: rpx(54),
    },
    brandSubtitle: {
        marginTop: rpx(6),
        lineHeight: rpx(30),
    },
    sectionCard: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: rpx(16),
        marginBottom: rpx(20),
        overflow: "hidden",
    },
    sectionHeader: {
        height: rpx(64),
        justifyContent: "center",
        paddingHorizontal: rpx(24),
    },
    actionCard: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: rpx(16),
        marginBottom: rpx(8),
        overflow: "hidden",
    },
    itemValue: {
        maxWidth: "52%",
        flexShrink: 1,
    },
    menuItem: {
        minHeight: 48,
    },
});

function CountDownItemInner() {
    const countDown = useScheduleCloseCountDown();
    const { t } = useI18N();

    return (
        <DrawerMenuItem
            icon="alarm-outline"
            title={t("sidebar.scheduleClose")}
            value={countDown ? timeformat(countDown) : undefined}
            onPress={() => {
                showPanel("TimingClose");
            }}
        />
    );
}

const CountDownItem = memo(CountDownItemInner, () => true);
