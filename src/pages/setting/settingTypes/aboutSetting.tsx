import React from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import DeviceInfo from "react-native-device-info";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import ThemeText from "@/components/base/themeText";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { ImgAsset } from "@/constants/assetsConst";
import { buildInfo } from "@/constants/buildInfo.generated";
import {
    PROJECT_RELEASES_URL,
    PROJECT_URL,
    UPSTREAM_URL,
} from "@/constants/projectLinks";
import { useI18N } from "@/core/i18n";
import { checkUpdateAndShowResult } from "@/hooks/useCheckUpdate.ts";
import openUrl from "@/utils/openUrl";
import Toast from "@/utils/toast";

// iOS 系统色图标块，和设置页一致
const TINT = {
    blue: "#007AFF",
    green: "#34C759",
    gray: "#8E8E93",
    pink: "#FF2D55",
};

/** 构建时间按本机时区显示到分钟；格式不对就原样显示 */
function formatBuildDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 复制给别人排查问题用，统一用英文标签 */
function buildInfoText(applicationName: string) {
    return [
        `${applicationName} ${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`,
        `Build: ${buildInfo.appVersion} / ${buildInfo.versionCode}`,
        `Commit: ${buildInfo.shortSha} (${buildInfo.gitRef})`,
        buildInfo.buildRunUrl ? `Build run: ${buildInfo.buildRunUrl}` : null,
        `Build time: ${buildInfo.buildDate}`,
        `Signing: ${buildInfo.signing}`,
        `Player: ${buildInfo.player}`,
        `Runtime: RN ${buildInfo.reactNative} / Expo ${buildInfo.expo} / React ${buildInfo.react}`,
    ]
        .filter(Boolean)
        .join("\n");
}

/** 左边名称、右边值的信息行；值较长时在右侧折行，可以长按选中复制 */
function InfoRow(props: { label: string; value: string }) {
    const { label, value } = props;
    return (
        <View
            style={styles.infoRow}
            accessible
            accessibilityLabel={`${label}，${value}`}>
            <ThemeText style={styles.infoLabel}>{label}</ThemeText>
            <ThemeText
                selectable
                fontColor="textSecondary"
                style={styles.infoValue}>
                {value}
            </ThemeText>
        </View>
    );
}

/**
 * 关于：这个修改版自己的版本、更新和源代码，构建信息，以及基于猫头猫的
 * MusicFree 修改、按 AGPL-3.0 开源的说明。
 */
export default function AboutSetting() {
    const { t } = useI18N();
    const applicationName = DeviceInfo.getApplicationName();
    const bottomInset = Math.max(useMusicBarFloatingOffset(24), 32);
    // 生成文件里是字面量类型，先放宽成 string 再比较
    const signingState: string = buildInfo.signing;
    const signing =
        signingState === "configured"
            ? t("about.build.signed")
            : signingState === "unsigned"
                ? t("about.build.unsigned")
                : signingState;
    const buildRunUrl: string = buildInfo.buildRunUrl;

    return (
        <ScrollView
            contentContainerStyle={[
                styles.content,
                { paddingBottom: bottomInset },
            ]}>
            <View style={styles.header}>
                <Image source={ImgAsset.logo} style={styles.logo} />
                <ThemeText
                    fontSize="title"
                    fontWeight="semibold"
                    style={styles.appName}>
                    {applicationName}
                </ThemeText>
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {t("about.versionLine", {
                        version: DeviceInfo.getVersion(),
                        build: DeviceInfo.getBuildNumber(),
                    })}
                </ThemeText>
            </View>

            <GroupedSection dividerInset={58}>
                <GroupedRow
                    icon="arrow-path"
                    iconTint={TINT.blue}
                    title={t("about.checkUpdate")}
                    onPress={() => checkUpdateAndShowResult(true)}
                />
                <GroupedRow
                    icon="arrow-down-tray"
                    iconTint={TINT.green}
                    title={t("about.releases")}
                    value="GitHub"
                    accessory="chevron"
                    onPress={() => openUrl(PROJECT_RELEASES_URL)}
                />
                <GroupedRow
                    icon="code-bracket-square"
                    iconTint={TINT.gray}
                    title={t("about.sourceCode")}
                    value="GitHub"
                    accessory="chevron"
                    onPress={() => openUrl(PROJECT_URL)}
                />
            </GroupedSection>

            <GroupedSection
                title={t("about.section.credits")}
                footer={t("about.licenseNotice")}
                dividerInset={58}>
                <GroupedRow
                    icon="heart-outline"
                    iconTint={TINT.pink}
                    title="MusicFree"
                    subtitle={t("about.upstreamAuthor")}
                    accessory="chevron"
                    onPress={() => openUrl(UPSTREAM_URL)}
                />
            </GroupedSection>

            <GroupedSection title={t("about.section.build")}>
                <InfoRow
                    label={t("about.build.version")}
                    value={`${buildInfo.appVersion} (${buildInfo.versionCode})`}
                />
                <InfoRow
                    label={t("about.build.commit")}
                    value={`${buildInfo.shortSha} · ${buildInfo.gitRef}`}
                />
                <InfoRow
                    label={t("about.build.date")}
                    value={formatBuildDate(buildInfo.buildDate)}
                />
                <InfoRow label={t("about.build.signing")} value={signing} />
                <InfoRow
                    label={t("about.build.player")}
                    value={buildInfo.player}
                />
                <InfoRow
                    label={t("about.build.runtime")}
                    value={`RN ${buildInfo.reactNative} · Expo ${buildInfo.expo} · React ${buildInfo.react}`}
                />
                {buildRunUrl ? (
                    <GroupedRow
                        title={t("about.build.run")}
                        accessory="chevron"
                        onPress={() => openUrl(buildRunUrl)}
                    />
                ) : null}
                <GroupedRow
                    title={t("about.build.copy")}
                    onPress={() => {
                        Clipboard.setString(buildInfoText(applicationName));
                        Toast.success(t("toast.copiedToClipboard"));
                    }}
                />
            </GroupedSection>

            <ThemeText
                fontSize="description"
                fontColor="textSecondary"
                style={styles.notice}>
                {t("about.pluginNotice")}
            </ThemeText>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingTop: 8,
    },
    header: {
        alignItems: "center",
        paddingHorizontal: 32,
        paddingTop: 16,
        paddingBottom: 4,
    },
    logo: {
        width: 76,
        height: 76,
        borderRadius: 17,
    },
    appName: {
        marginTop: 12,
        marginBottom: 2,
    },
    infoRow: {
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    infoLabel: {
        flexShrink: 0,
    },
    infoValue: {
        flex: 1,
        textAlign: "right",
    },
    notice: {
        marginHorizontal: 32,
        marginTop: 22,
    },
});
