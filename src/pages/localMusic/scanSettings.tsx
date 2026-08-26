import AppBar from "@/components/base/appBar";
import ListItem from "@/components/base/listItem";
import StatusBar from "@/components/base/statusBar";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import { showPanel } from "@/components/panels/usePanel";
import globalStyle from "@/constants/globalStyle";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import {
    localMusicMinDurationOptions,
    localMusicMinFileSizeOptions,
    normalizeLocalMusicScanPolicy,
    type ILocalMusicScanPolicy,
} from "@/core/localMusicScanPolicy";
import rpx from "@/utils/rpx";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";

export default function LocalMusicScanSettings() {
    const { t } = useI18N();
    const storedPolicy = useAppConfig("localMusic.scanPolicy");
    const policy = normalizeLocalMusicScanPolicy(storedPolicy);

    function updatePolicy(patch: Partial<ILocalMusicScanPolicy>) {
        Config.setConfig("localMusic.scanPolicy", {
            ...policy,
            ...patch,
        });
    }

    function getDurationLabel(value: number) {
        return value === 0
            ? t("localMusic.scanSettings.noLimit")
            : t("localMusic.scanSettings.seconds", { value });
    }

    function getFileSizeLabel(value: number) {
        if (value === 0) {
            return t("localMusic.scanSettings.noLimit");
        }
        if (value < 1024 * 1024) {
            return t("localMusic.scanSettings.kilobytes", {
                value: value / 1024,
            });
        }
        return t("localMusic.scanSettings.megabytes", {
            value: value / (1024 * 1024),
        });
    }

    function selectMinimumDuration() {
        showPanel("SimpleSelect", {
            header: t("localMusic.scanSettings.minDuration"),
            candidates: localMusicMinDurationOptions.map(value => ({
                title: getDurationLabel(value),
                value,
            })),
            onPress(candidate) {
                updatePolicy({ minDurationSeconds: candidate.value });
            },
        });
    }

    function selectMinimumFileSize() {
        showPanel("SimpleSelect", {
            header: t("localMusic.scanSettings.minFileSize"),
            candidates: localMusicMinFileSizeOptions.map(value => ({
                title: getFileSizeLabel(value),
                value,
            })),
            onPress(candidate) {
                updatePolicy({ minFileSizeBytes: candidate.value });
            },
        });
    }

    const setFilterLikelySystemSounds = (value: boolean) => {
        updatePolicy({
            filterLikelySystemSounds: value,
        });
    };

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("localMusic.scanSettings.title")}</AppBar>
            <ScrollView contentContainerStyle={styles.content}>
                <ThemeText
                    fontColor="textSecondary"
                    style={styles.description}>
                    {t("localMusic.scanSettings.affectsFutureScans")}
                </ThemeText>
                <ListItem
                    withHorizontalPadding
                    heightType="big"
                    onPress={selectMinimumDuration}>
                    <ListItem.Content
                        title={t("localMusic.scanSettings.minDuration")}
                        description={getDurationLabel(
                            policy.minDurationSeconds,
                        )}
                    />
                    <ListItem.ListItemIcon
                        icon="chevron-right"
                        position="right"
                    />
                </ListItem>
                <ListItem
                    withHorizontalPadding
                    heightType="big"
                    onPress={selectMinimumFileSize}>
                    <ListItem.Content
                        title={t("localMusic.scanSettings.minFileSize")}
                        description={getFileSizeLabel(
                            policy.minFileSizeBytes,
                        )}
                    />
                    <ListItem.ListItemIcon
                        icon="chevron-right"
                        position="right"
                    />
                </ListItem>
                <ListItem
                    withHorizontalPadding
                    heightType="big"
                    onPress={() =>
                        setFilterLikelySystemSounds(
                            !policy.filterLikelySystemSounds,
                        )
                    }
                    accessibilityLabel={t(
                        "localMusic.scanSettings.filterSystemSounds",
                    )}
                    accessibilityState={{
                        checked: policy.filterLikelySystemSounds,
                    }}>
                    <ListItem.Content
                        title={t("localMusic.scanSettings.filterSystemSounds")}
                        description={t(
                            "localMusic.scanSettings.filterSystemSoundsDescription",
                        )}
                    />
                    <ThemeSwitch
                        value={policy.filterLikelySystemSounds}
                        onValueChange={setFilterLikelySystemSounds}
                    />
                </ListItem>
            </ScrollView>
        </VerticalSafeAreaView>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingBottom: rpx(40),
    },
    description: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(28),
        lineHeight: rpx(38),
    },
});
