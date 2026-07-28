import React from "react";
import { Pressable, StyleSheet } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";

import {
    getQualityOptions,
    getQualitySize,
    getQualityText,
    type QualityAvailabilityStatus,
} from "@/utils/qualities";
import PluginManager from "@/core/pluginManager";
import { sizeFormatter } from "@/utils/fileUtils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import { ScrollView } from "react-native-gesture-handler";
import { hidePanel } from "../usePanel";
import Divider from "@/components/base/divider";
import PanelHeader from "../base/panelHeader";
import { useI18N } from "@/core/i18n";
import { useAppConfig } from "@/core/appConfig";

interface IMusicQualityProps {
    type?: "play" | "download";
    /** 歌曲信息 */
    musicItem: IMusic.IMusicItem;
    /** 点击回调 */
    onQualityPress: (
        quality: IMusic.IQualityKey,
        musicItem: IMusic.IMusicItem,
    ) => void;
}

const qualityStatusI18nKeys: Record<
    QualityAvailabilityStatus,
    | "panel.musicQuality.status.resolved"
    | "panel.musicQuality.status.metadata"
    | "panel.musicQuality.status.declared"
    | "panel.musicQuality.status.unknown"
> = {
    resolved: "panel.musicQuality.status.resolved",
    metadata: "panel.musicQuality.status.metadata",
    declared: "panel.musicQuality.status.declared",
    unknown: "panel.musicQuality.status.unknown",
};

export default function MusicQuality(props: IMusicQualityProps) {
    const safeAreaInsets = useSafeAreaInsets();
    const i18n = useI18N();
    const customQualityTranslations = useAppConfig("basic.qualityTranslations");
    const qualityTextI18n = getQualityText(
        i18n.getLanguage().languageData,
        customQualityTranslations,
    );

    const { musicItem, onQualityPress, type = "play" } = props ?? {};
    const plugin = PluginManager.getByMedia(musicItem);
    const qualityOptions = getQualityOptions(musicItem, plugin?.instance);

    return (
        <PanelBase
            height={rpx(520)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={i18n.t("panel.musicQuality.title", {
                            type:
                                type === "play"
                                    ? i18n.t("common.play")
                                    : i18n.t("common.download"),
                        })}
                        hideButtons
                    />
                    <Divider />

                    <ScrollView
                        style={[
                            style.body,
                            {
                                marginBottom: safeAreaInsets.bottom,
                            },
                        ]}>
                        {qualityOptions.map(option => {
                            const key = option.key;
                            const qualityLabel = qualityTextI18n[key] ?? key;
                            const qualitySize = getQualitySize(
                                musicItem,
                                key,
                            );
                            const statusText = i18n.t(
                                qualityStatusI18nKeys[option.status],
                            );
                            return (
                                <Pressable
                                    key={`btn-${key}`}
                                    style={style.item}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${qualityLabel}，${statusText}`}
                                    onPress={() => {
                                        onQualityPress(key, musicItem);
                                        hidePanel();
                                    }}>
                                    <ThemeText>
                                        {qualityLabel}{" "}
                                        {qualitySize
                                            ? `(${sizeFormatter(qualitySize)})`
                                            : ""}
                                    </ThemeText>
                                    <ThemeText style={style.statusText}>
                                        {statusText}
                                    </ThemeText>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </>
            )}
        />
    );
}

const style = StyleSheet.create({
    header: {
        width: rpx(750),
        flexDirection: "row",
        padding: rpx(24),
    },
    body: {
        flex: 1,
        paddingHorizontal: rpx(24),
    },
    item: {
        minHeight: rpx(96),
        justifyContent: "center",
        paddingVertical: rpx(12),
    },
    statusText: {
        marginTop: rpx(6),
        fontSize: rpx(22),
        opacity: 0.55,
    },
});
