import AppBar from "@/components/base/appBar";
import ListItem from "@/components/base/listItem";
import StatusBar from "@/components/base/statusBar";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import downloadNotificationManager from "@/core/downloadNotificationManager";
import { useI18N } from "@/core/i18n";
import LyricUtil from "@/native/lyricUtil";
import NativeUtils from "@/native/utils";
import {
    checkAndroidAudioReadPermission,
    toggleAndroidAudioReadPermission,
} from "@/utils/androidMediaPermission";
import rpx from "@/utils/rpx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet } from "react-native";

type IPermissionTypes =
    | "floatingWindow"
    | "audioFiles"
    | "batteryOptimization"
    | "notification";

export default function Permissions() {
    const appState = useRef(AppState.currentState);
    const [permissions, setPermissions] = useState<
        Record<IPermissionTypes, boolean>
    >({
        floatingWindow: false,
        audioFiles: false,
        batteryOptimization: false,
        notification: false,
    });
    const { t } = useI18N();

    const checkPermission = useCallback(async (type?: IPermissionTypes) => {
        const updates: Partial<Record<IPermissionTypes, boolean>> = {};

        if (!type || type === "floatingWindow") {
            updates.floatingWindow = await LyricUtil.checkSystemAlertPermission();
        }
        if (!type || type === "audioFiles") {
            updates.audioFiles = await checkAndroidAudioReadPermission();
        }
        if (!type || type === "batteryOptimization") {
            updates.batteryOptimization = await NativeUtils.isIgnoringBatteryOptimizations();
        }
        if (!type || type === "notification") {
            updates.notification =
                await downloadNotificationManager.checkNotificationPermission();
        }

        setPermissions(prev => ({ ...prev, ...updates }));
    }, []);

    // 应用从 0.7.3 起不再申请「所有文件访问」：下载存在应用自己的目录，导入和
    // 备份走系统文件选择器，只有扫描、播放手机里的本地音乐要读音频文件
    const toggleAudioFiles = useCallback(() => {
        toggleAndroidAudioReadPermission()
            .catch(() => false)
            .then(() => checkPermission("audioFiles"));
    }, [checkPermission]);

    const toggleBatteryOptimization = useCallback(() => {
        if (permissions.batteryOptimization) {
            NativeUtils.openBatteryOptimizationSettings();
        } else {
            NativeUtils.requestIgnoreBatteryOptimizations();
        }
    }, [permissions.batteryOptimization]);

    useEffect(() => {
        checkPermission();
        const subscription = AppState.addEventListener(
            "change",
            nextAppState => {
                if (
                    appState.current.match(/inactive|background/) &&
                    nextAppState === "active"
                ) {
                    checkPermission();
                }

                appState.current = nextAppState;
            },
        );

        return () => {
            subscription.remove();
        };
    }, [checkPermission]);

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("permissionSetting.title")}</AppBar>
            <ThemeText style={styles.description}>
                {t("permissionSetting.description")}
            </ThemeText>
            <ListItem
                withHorizontalPadding
                heightType="big"
                onPress={() => {
                    LyricUtil.requestSystemAlertPermission();
                }}
                accessibilityLabel={t("permissionSetting.floatWindowPermission")}
                accessibilityState={{ checked: permissions.floatingWindow }}>
                <ListItem.Content
                    title={t("permissionSetting.floatWindowPermission")}
                    description={t("permissionSetting.floatWindowPermissionDescription")}
                />
                <ThemeSwitch
                    value={permissions.floatingWindow}
                    onValueChange={() => {
                        LyricUtil.requestSystemAlertPermission();
                    }}
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="big"
                onPress={toggleAudioFiles}
                accessibilityLabel={t("permissionSetting.audioPermission")}
                accessibilityState={{ checked: permissions.audioFiles }}>
                <ListItem.Content
                    title={t("permissionSetting.audioPermission")}
                    description={t("permissionSetting.audioPermissionDescription")}
                />
                <ThemeSwitch
                    value={permissions.audioFiles}
                    onValueChange={toggleAudioFiles}
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="big"
                onPress={() => {
                    downloadNotificationManager
                        .requestNotificationPermission()
                        .then(() => checkPermission("notification"));
                }}
                accessibilityLabel={t("permissionSetting.notificationPermission")}
                accessibilityState={{ checked: permissions.notification }}>
                <ListItem.Content
                    title={t("permissionSetting.notificationPermission")}
                    description={t("permissionSetting.notificationPermissionDescription")}
                />
                <ThemeSwitch
                    value={permissions.notification}
                    onValueChange={() => {
                        downloadNotificationManager
                            .requestNotificationPermission()
                            .then(() => checkPermission("notification"));
                    }}
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="big"
                onPress={toggleBatteryOptimization}
                accessibilityLabel={t("permissionSetting.ignoreBatteryOptimization")}
                accessibilityState={{ checked: permissions.batteryOptimization }}>
                <ListItem.Content
                    title={t("permissionSetting.ignoreBatteryOptimization")}
                    description={t("permissionSetting.ignoreBatteryOptimizationDescription")}
                />
                <ThemeSwitch
                    value={permissions.batteryOptimization}
                    onValueChange={toggleBatteryOptimization}
                />
            </ListItem>
        </VerticalSafeAreaView>
    );
}

const styles = StyleSheet.create({
    description: {
        width: "100%",
        paddingHorizontal: rpx(24),
        marginVertical: rpx(36),
    },
});
