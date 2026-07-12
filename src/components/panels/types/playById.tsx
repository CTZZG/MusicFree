import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import PluginManager from "@/core/pluginManager";
import { Plugin } from "@/core/pluginManager/plugin";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useMemo, useState } from "react";
import { useOnMounted } from "@/hooks/useMounted";
import { StyleSheet, View } from "react-native";
import { Pressable, TextInput } from "react-native-gesture-handler";
import NoPlugin from "@/components/base/noPlugin";
import { fontSizeConst } from "@/constants/uiConst";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";
import { useShortcutCardStyle } from "@/components/base/shortcutPageSurface";

function buildMusicBase(pluginName: string, inputValue: string) {
    return {
        id: inputValue,
        songid: inputValue,
        songmid: inputValue,
        mid: inputValue,
        hash: inputValue,
        copyrightId: inputValue,
        platform: pluginName,
    };
}

export default function PlayById() {
    const { t } = useI18N();
    const colors = useColors();
    const cardStyle = useShortcutCardStyle();
    const navigate = useNavigate();

    const plugins = useMemo(
        () => PluginManager.getSortedPluginsWithAbility("getMediaSource"),
        [],
    );
    const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(
        plugins[0] ?? null,
    );
    const [musicId, setMusicId] = useState("");
    const [loading, setLoading] = useState(false);
    const { onMounted } = useOnMounted();

    const handlePlay = async () => {
        if (loading) {
            return;
        }
        if (!selectedPlugin) {
            Toast.warn(t("panel.playById.selectPluginFirst"));
            return;
        }

        const inputValue = musicId.trim();
        if (!inputValue) {
            Toast.warn(t("panel.playById.inputIdFirst"));
            return;
        }

        setLoading(true);
        try {
            const musicBase = buildMusicBase(selectedPlugin.name, inputValue);
            const musicInfo = selectedPlugin.supportedMethods.has(
                "getMusicInfo",
            )
                ? await selectedPlugin.methods.getMusicInfo(musicBase)
                : null;

            const musicItem = {
                ...musicBase,
                title: musicInfo?.title || inputValue,
                artist:
                    musicInfo?.artist ||
                    t("panel.playById.unknownArtist"),
                album: musicInfo?.album || "",
                artwork: musicInfo?.artwork || "",
                duration: Number(musicInfo?.duration) || 0,
                ...musicInfo,
                id: musicInfo?.id || musicBase.id,
                platform: selectedPlugin.name,
                songid: musicInfo?.songid || musicBase.songid,
                songmid:
                    musicInfo?.songmid ||
                    musicInfo?.mid ||
                    musicBase.songmid,
                mid: musicInfo?.mid || musicBase.mid,
                hash: musicInfo?.hash || musicBase.hash,
                copyrightId:
                    musicInfo?.copyrightId || musicBase.copyrightId,
            } as IMusic.IMusicItem;

            await TrackPlayer.play(musicItem);
            hidePanel();
            navigate(ROUTE_PATH.MUSIC_DETAIL);
            Toast.success(t("panel.playById.playingNow"));
        } catch {
            Toast.warn(t("panel.playById.fetchFailed"));
        } finally {
            if (onMounted()) setLoading(false);
        }
    };

    return (
        <PanelBase
            keyboardAvoidBehavior="height"
            height={vmax(58)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.playById.title")}
                        onCancel={hidePanel}
                        onOk={handlePlay}
                        okText={
                            loading ? t("common.loading") : undefined
                        }
                    />

                    {plugins.length ? (
                        <>
                            <View style={[cardStyle, styles.pluginSection]}>
                                <ThemeText
                                    fontSize="subTitle"
                                    fontColor="textSecondary"
                                    style={styles.sectionLabel}>
                                    {t("panel.playById.selectPlugin")}
                                </ThemeText>
                                <View style={styles.pluginGrid}>
                                    {plugins.map(plugin => {
                                        const isSelected =
                                            selectedPlugin?.hash ===
                                            plugin.hash;
                                        return (
                                            <Pressable
                                                key={plugin.hash}
                                                style={[
                                                    styles.pluginChip,
                                                    {
                                                        backgroundColor:
                                                            isSelected
                                                                ? colors.primary
                                                                : "transparent",
                                                        borderColor:
                                                            isSelected
                                                                ? colors.primary
                                                                : colors.divider,
                                                    },
                                                ]}
                                                onPress={() =>
                                                    setSelectedPlugin(plugin)
                                                }>
                                                <ThemeText
                                                    fontSize="subTitle"
                                                    numberOfLines={1}
                                                    style={{
                                                        color: isSelected
                                                            ? "#fff"
                                                            : colors.text,
                                                    }}>
                                                    {plugin.name}
                                                </ThemeText>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>

                            <View style={[cardStyle, styles.inputSection]}>
                                <TextInput
                                    value={musicId}
                                    accessible
                                    accessibilityLabel={t(
                                        "panel.playById.inputLabel",
                                    )}
                                    accessibilityHint={t(
                                        "panel.playById.placeholder",
                                    )}
                                    onChangeText={setMusicId}
                                    style={[
                                        styles.input,
                                        {
                                            color: colors.text,
                                            backgroundColor: "transparent",
                                            borderColor: colors.divider,
                                        },
                                    ]}
                                    placeholderTextColor={
                                        colors.textSecondary
                                    }
                                    placeholder={t(
                                        "panel.playById.placeholder",
                                    )}
                                    maxLength={200}
                                />
                                <View style={styles.hints}>
                                    <ThemeText
                                        style={styles.hintLine}
                                        fontSize="description"
                                        fontColor="textSecondary">
                                        {t("panel.playById.hint")}
                                    </ThemeText>
                                    {selectedPlugin?.name === "QQ音乐" ||
                                    selectedPlugin?.name?.startsWith(
                                        "QQ音乐",
                                    ) ? (
                                            <ThemeText
                                                style={styles.hintLine}
                                                fontSize="description"
                                                fontColor="textSecondary">
                                                {t("panel.playById.qqHint")}
                                            </ThemeText>
                                        ) : null}
                                </View>
                            </View>
                        </>
                    ) : (
                        <NoPlugin notSupportType={t("panel.playById.title")} />
                    )}
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    pluginSection: {
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(20),
    },
    sectionLabel: {
        marginBottom: rpx(12),
    },
    pluginGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: rpx(12),
    },
    pluginChip: {
        minWidth: "22%",
        paddingHorizontal: rpx(14),
        paddingVertical: rpx(14),
        borderRadius: rpx(22),
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    inputSection: {
        paddingVertical: rpx(20),
    },
    input: {
        marginHorizontal: rpx(20),
        borderRadius: rpx(16),
        borderWidth: 1,
        fontSize: fontSizeConst.content,
        lineHeight: fontSizeConst.content * 1.5,
        paddingHorizontal: rpx(18),
        paddingVertical: rpx(16),
    },
    hints: {
        paddingHorizontal: rpx(24),
        marginTop: rpx(16),
    },
    hintLine: {
        marginBottom: rpx(12),
    },
});
