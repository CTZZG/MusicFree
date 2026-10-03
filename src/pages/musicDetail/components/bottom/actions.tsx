import React, { useMemo } from "react";
import { InteractionManager, Pressable, StyleSheet, View } from "react-native";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import { showPanel } from "@/components/panels/usePanel";
import { MusicRepeatModeInfo } from "@/constants/trackPlayerConst";
import downloader from "@/core/downloader";
import { useI18N } from "@/core/i18n";
import LocalMusicSheet from "@/core/localMusicSheet";
import PluginManager from "@/core/pluginManager";
import TrackPlayer, {
    useCurrentMusic,
    useRepeatMode,
} from "@/core/trackPlayer";
import delay from "@/utils/delay";
import Toast from "@/utils/toast";

const ICON_COLOR = "rgba(255, 255, 255, 0.78)";

function ActionButton(props: {
    icon: IIconName;
    accessibilityLabel: string;
    selected?: boolean;
    dimmed?: boolean;
    onPress: () => void;
}) {
    const { icon, accessibilityLabel, selected, dimmed, onPress } = props;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={
                selected === undefined ? undefined : { selected }
            }
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                selected ? styles.selected : null,
                pressed ? styles.pressed : null,
            ]}>
            <Icon
                name={icon}
                size={24}
                color={selected ? "#1F2A48" : ICON_COLOR}
                opacity={dimmed ? 0.35 : 1}
            />
        </Pressable>
    );
}

interface IPlayerActionsProps {
    /** 竖屏时可以在封面和歌词之间切换；横屏两者并排，不显示这个按钮 */
    lyricTab?: {
        showingLyric: boolean;
        toggle: () => void;
    };
}

/** 播放页最下面一排：播放模式、歌词、下载、评论、播放列表 */
export default function PlayerActions(props: IPlayerActionsProps) {
    const { lyricTab } = props;
    const musicItem = useCurrentMusic();
    const repeatMode = useRepeatMode();
    const isDownloaded = LocalMusicSheet.useIsLocal(musicItem);
    const { t } = useI18N();

    const supportComment = useMemo(
        () =>
            !!musicItem &&
            !!PluginManager.getByMedia(musicItem)?.supportedMethods.has(
                "getMusicComments",
            ),
        [musicItem],
    );

    return (
        <View style={styles.wrapper}>
            <ActionButton
                icon={MusicRepeatModeInfo[repeatMode].icon}
                accessibilityLabel={t(`repeatMode.${repeatMode}`)}
                onPress={() => {
                    InteractionManager.runAfterInteractions(async () => {
                        await delay(20, false);
                        TrackPlayer.toggleRepeatMode();
                    });
                }}
            />
            {lyricTab ? (
                <ActionButton
                    icon="lyric"
                    selected={lyricTab.showingLyric}
                    accessibilityLabel={t(
                        lyricTab.showingLyric
                            ? "musicDetail.showCover.a11y"
                            : "musicDetail.showLyric.a11y",
                    )}
                    onPress={lyricTab.toggle}
                />
            ) : null}
            <ActionButton
                icon={isDownloaded ? "check-circle-outline" : "arrow-down-tray"}
                accessibilityLabel={
                    isDownloaded
                        ? t("panel.musicItemOptions.downloaded")
                        : t("common.download")
                }
                onPress={() => {
                    if (musicItem && !isDownloaded) {
                        showPanel("MusicQuality", {
                            type: "download",
                            musicItem,
                            async onQualityPress(quality) {
                                downloader.download(musicItem, quality);
                            },
                        });
                    }
                }}
            />
            <ActionButton
                icon="chat-bubble-oval-left-ellipsis"
                dimmed={!supportComment}
                accessibilityLabel={t("common.comment")}
                onPress={() => {
                    if (!supportComment) {
                        Toast.warn(
                            t("toast.commmentNotAvaliableForCurrentMusic"),
                        );
                        return;
                    }
                    if (musicItem) {
                        showPanel("MusicComment", { musicItem });
                    }
                }}
            />
            <ActionButton
                icon="playlist"
                accessibilityLabel={t("musicBar.playlist.a11y")}
                onPress={() => {
                    showPanel("PlayList");
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 34,
        paddingTop: 4,
    },
    button: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    // 歌词打开时按钮变成白底，和设计稿一致
    selected: {
        backgroundColor: "rgba(255, 255, 255, 0.92)",
    },
    pressed: {
        opacity: 0.5,
    },
});
