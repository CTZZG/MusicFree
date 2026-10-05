import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import TrackPlayer from "@/core/trackPlayer";
import { PlaybackFailureNotice, playbackRecovery } from "@/core/trackPlayer/playbackRecovery";
import { getMediaSourceFailureI18nKey } from "@/core/pluginManager/mediaSourceFailure";
import { navigateToSearch, ROUTE_PATH, useNavigate } from "@/core/router";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel, showPanel } from "../usePanel";

export default function PlaybackRecovery(props: { notice: PlaybackFailureNotice }) {
    const { notice } = props;
    const { musicItem, failure } = notice;
    const { t } = useI18N();
    const navigate = useNavigate();
    const insets = useSafeAreaInsets();
    const closeForAction = () => {
        hidePanel();
        return playbackRecovery.dismiss(notice.id);
    };
    const actions = [
        {
            label: t("common.retry"),
            run: () => {
                if (closeForAction()) {
                    TrackPlayer.retryPlayback(musicItem);
                }
            },
        },
        {
            label: t("playbackRecovery.chooseQuality"),
            run: () => {
                if (playbackRecovery.state.getValue()?.id !== notice.id) {
                    hidePanel();
                    return;
                }
                showPanel("MusicQuality", {
                    musicItem,
                    onQualityPress: quality => {
                        if (playbackRecovery.dismiss(notice.id)) {
                            TrackPlayer.retryPlayback(musicItem, quality);
                        }
                    },
                });
            },
        },
        {
            label: t("playbackRecovery.otherSource"),
            run: () => {
                if (closeForAction()) {
                    navigateToSearch({
                        initialQuery: [musicItem.title, musicItem.artist].filter(Boolean).join(" "),
                        initialSearchType: "music",
                    });
                }
            },
        },
        {
            label: t("playbackRecovery.pluginSettings"),
            run: () => {
                if (closeForAction()) {
                    navigate(ROUTE_PATH.SETTING, {
                        type: "plugin",
                        initialPluginName: failure.pluginName ?? musicItem.platform,
                    });
                }
            },
        },
    ];
    return (
        <PanelBase renderBody={() => (
            <>
                <PanelHeader title={t("playbackRecovery.title")} hideButtons />
                <ScrollView contentContainerStyle={[
                    styles.body,
                    { paddingBottom: insets.bottom + 16 },
                ]}>
                    <View style={styles.summary}>
                        <ThemeText fontWeight="semibold">{musicItem.title}</ThemeText>
                        <ThemeText>{musicItem.artist} · {failure.pluginName ?? musicItem.platform}</ThemeText>
                        <ThemeText>{t(getMediaSourceFailureI18nKey(failure.code))}</ThemeText>
                        {failure.code === "access-denied" ? (
                            <ThemeText>{t("playbackRecovery.accessHint")}</ThemeText>
                        ) : null}
                    </View>
                    {actions.map(action => (
                        <Pressable
                            key={action.label}
                            style={styles.action}
                            accessibilityRole="button"
                            onPress={action.run}>
                            <ThemeText fontColor="primary">{action.label}</ThemeText>
                        </Pressable>
                    ))}
                </ScrollView>
            </>
        )} />
    );
}

const styles = StyleSheet.create({
    body: { paddingHorizontal: 20 },
    summary: { gap: 8, paddingVertical: 12 },
    action: { minHeight: 48, justifyContent: "center", paddingVertical: 12 },
});
