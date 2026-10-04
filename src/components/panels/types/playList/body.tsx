import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import Loading from "@/components/base/loading";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import useColors from "@/hooks/useColors";
import TrackPlayer, {
    useCurrentMusic,
    usePlayLaterQueue,
    usePlayList,
    useQueueUndo,
} from "@/core/trackPlayer";
import type { IPlaybackQueueScope } from "@/types/core/trackPlayer";
import { FlashList } from "@shopify/flash-list";
import Icon from "@/components/base/icon";
import { useI18N } from "@/core/i18n";
import { showPanel } from "../../usePanel";

type IPlayListRow =
    | {
          type: "header";
          key: string;
          title: string;
          count: number;
          onClear?: () => void;
      }
    | {
          type: "normal" | "later";
          key: string;
          item: IMusic.IMusicItem;
      };

interface IPlayListProps {
    item: IMusic.IMusicItem;
    isCurrentMusic: boolean;
    isPlayLater?: boolean;
}

function PlayListItemView(props: IPlayListProps) {
    const colors = useColors();
    const { t } = useI18N();
    const { item, isCurrentMusic, isPlayLater } = props;
    const scope: IPlaybackQueueScope = isPlayLater ? "later" : "normal";
    const openEditMenu = () => {
        const queue = isPlayLater ? TrackPlayer.playLaterQueue : TrackPlayer.playList;
        const position = queue.findIndex(entry => isSameMediaItem(entry, item));
        if (position < 0) {
            return;
        }
        const candidates = [
            ...(position > 0 ? [{ title: t("panel.playList.moveUp"), value: "up" }] : []),
            ...(position + 1 < queue.length ? [{ title: t("panel.playList.moveDown"), value: "down" }] : []),
            ...(!TrackPlayer.isCurrentMusic(item) ? [{ title: t("panel.playList.moveNext"), value: "next" }] : []),
            { title: t("panel.playList.remove"), value: "remove" },
        ];
        showPanel("SimpleSelect", {
            header: t("panel.playList.edit"),
            candidates,
            onPress: action => {
                const latestQueue = isPlayLater ? TrackPlayer.playLaterQueue : TrackPlayer.playList;
                const latestPosition = latestQueue.findIndex(entry => isSameMediaItem(entry, item));
                if (action.value === "next") {
                    TrackPlayer.moveQueueItemNext(item, scope);
                } else if (action.value === "remove") {
                    TrackPlayer.removeQueueItemWithUndo(item, scope);
                } else if (latestPosition >= 0) {
                    TrackPlayer.moveQueueItem(item, latestPosition + (action.value === "up" ? -1 : 1), scope);
                }
                showPanel("PlayList");
            },
        });
    };
    return (
        <View style={styles.musicItem}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.artist ?? ""}, ${item.platform}`}
                style={styles.song}
                onPress={() => {
                    if (isPlayLater) {
                        TrackPlayer.removePlayLater(item);
                    }
                    TrackPlayer.play(item, true);
                }}>
                {isPlayLater || isCurrentMusic ? (
                    <Icon
                        name={isPlayLater ? "clock-outline" : "musical-note"}
                        color={isCurrentMusic ? colors.textHighlight ?? colors.primary : colors.primary}
                        size={16}
                        style={styles.currentPlaying}
                    />
                ) : null}
                <View style={styles.songInfo}>
                    <ThemeText
                        style={{ color: isCurrentMusic ? colors.textHighlight ?? colors.primary : colors.text }}
                        ellipsizeMode="tail"
                        numberOfLines={1}>
                        {item.title}
                    </ThemeText>
                    <ThemeText fontSize="description" fontColor="textSecondary" numberOfLines={1}>
                        {[item.artist, item.platform].filter(Boolean).join(" · ")}
                    </ThemeText>
                </View>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("panel.playList.edit")}：${item.title}`}
                style={styles.iconButton}
                onPress={openEditMenu}>
                <Icon name="ellipsis-vertical" color={colors.text} size={22} />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("panel.playList.remove")}：${item.title}`}
                style={styles.iconButton}
                onPress={() => {
                    TrackPlayer.removeQueueItemWithUndo(item, scope);
                }}>
                <Icon name="x-mark" color={colors.textSecondary} size={22} />
            </Pressable>
        </View>
    );
}

const PlayListItem = React.memo(
    PlayListItemView,
    (prev, next) =>
        !!isSameMediaItem(prev.item, next.item) &&
        prev.item.title === next.item.title &&
        prev.item.artist === next.item.artist &&
        prev.item.platform === next.item.platform &&
        prev.isCurrentMusic === next.isCurrentMusic &&
        prev.isPlayLater === next.isPlayLater,
);

interface IBodyProps { loading?: boolean }
export default function Body(props: IBodyProps) {
    const { loading } = props;
    const colors = useColors();
    const playList = usePlayList();
    const playLaterQueue = usePlayLaterQueue();
    const currentMusicItem = useCurrentMusic();
    const undo = useQueueUndo();
    const { t } = useI18N();
    const safeAreaInsets = useSafeAreaInsets();

    const listData = useMemo<IPlayListRow[]>(() => {
        const rows: IPlayListRow[] = [];
        if (playLaterQueue.length) {
            rows.push({
                type: "header", key: "play-later-header", title: t("playLater.title"),
                count: playLaterQueue.length,
                onClear: () => {
                    TrackPlayer.clearQueueWithUndo("later");
                },
            });
            playLaterQueue.forEach(item => rows.push({ type: "later", key: `later:${getMediaUniqueKey(item)}`, item }));
            rows.push({ type: "header", key: "playlist-header", title: t("panel.playList.title"), count: playList.length });
        }
        playList.forEach(item => rows.push({ type: "normal", key: `normal:${getMediaUniqueKey(item)}`, item }));
        return rows;
    }, [playLaterQueue, playList, t]);

    const initIndex = useMemo(() => {
        const index = listData.findIndex(row => row.type === "normal" && isSameMediaItem(row.item, currentMusicItem));
        return index === -1 ? undefined : index;
    }, [currentMusicItem, listData]);

    const renderItem = ({ item }: { item: IPlayListRow }) => item.type === "header" ? (
        <View style={styles.sectionHeader}>
            <ThemeText style={styles.sectionTitle} fontSize="subTitle" fontWeight="bold" fontColor="textSecondary">
                {item.title}{t("panel.playList.count", { count: item.count })}
            </ThemeText>
            {item.onClear ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${t("common.clear")} ${item.title}`} style={styles.iconButton} onPress={item.onClear}>
                    <Icon name="trash-outline" color={colors.textSecondary} size={22} />
                </Pressable>
            ) : null}
        </View>
    ) : (
        <PlayListItem item={item.item} isCurrentMusic={!!isSameMediaItem(item.item, currentMusicItem)} isPlayLater={item.type === "later"} />
    );

    return (
        <View style={[styles.playList, { paddingBottom: safeAreaInsets.bottom }]}>
            {loading ? <Loading /> : (
                <FlashList extraData={{ currentMusicItem }} data={listData} initialScrollIndex={initIndex} keyExtractor={item => item.key} renderItem={renderItem} />
            )}
            {undo ? (
                <View style={styles.undoBar} accessibilityLiveRegion="polite">
                    <View style={styles.undoInfo}>
                        <ThemeText fontSize="description">
                            {t(undo.action === "clear" ? "panel.playList.cleared" : "panel.playList.removed", { count: undo.count })}
                        </ThemeText>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("panel.playList.undo")} accessibilityHint={t("panel.playList.undoHint")} style={styles.undoButton} onPress={() => TrackPlayer.undoQueueEdit(undo.id)}>
                        <ThemeText fontColor="primary">{t("panel.playList.undo")}</ThemeText>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    playList: { width: "100%", flex: 1 },
    currentPlaying: { marginRight: 6 },
    sectionHeader: { minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
    sectionTitle: { flex: 1, paddingVertical: 6 },
    musicItem: { minHeight: 56, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
    song: { flex: 1, minHeight: 44, paddingVertical: 8, flexDirection: "row", alignItems: "center" },
    songInfo: { flex: 1, minWidth: 0 },
    iconButton: { width: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
    undoBar: { paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", alignItems: "center" },
    undoInfo: { flex: 1, minWidth: 0 },
    undoButton: { minHeight: 44, minWidth: 44, maxWidth: "40%", marginLeft: 12, justifyContent: "center" },
});
