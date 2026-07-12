import React, { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import Tag from "@/components/base/tag";
import ThemeText from "@/components/base/themeText";
import { fontSizeConst } from "@/constants/uiConst";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import IconButton from "@/components/base/iconButton";
import Loading from "@/components/base/loading";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import useColors from "@/hooks/useColors";
import TrackPlayer, {
    useCurrentMusic,
    usePlayLaterQueue,
    usePlayList,
} from "@/core/trackPlayer";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import Icon from "@/components/base/icon.tsx";
import { useI18N } from "@/core/i18n";

const ITEM_HEIGHT = rpx(108);
const ITEM_WIDTH = rpx(750);

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
    const { item, isCurrentMusic, isPlayLater } = props;

    return (
        <Pressable
            onPress={() => {
                if (isPlayLater) {
                    TrackPlayer.removePlayLater(item);
                }
                TrackPlayer.play(item, true);
            }}
            style={style.musicItem}>
            {isPlayLater ? (
                <Icon
                    name="clock-outline"
                    color={colors.primary}
                    size={fontSizeConst.content}
                    style={style.currentPlaying}
                />
            ) : isCurrentMusic ? (
                <Icon
                    name="musical-note"
                    color={colors.textHighlight ?? colors.primary}
                    size={fontSizeConst.content}
                    style={style.currentPlaying}
                />
            ) : null}
            <ThemeText
                style={[
                    style.musicItemTitle,
                    {
                        color: isCurrentMusic
                            ? colors.textHighlight ?? colors.primary
                            : colors.text,
                    },
                ]}
                ellipsizeMode="tail"
                numberOfLines={1}>
                {item.title}
                {item.artist && (
                    <Text style={{ fontSize: fontSizeConst.description }}>
                        {" "}
                        - {item.artist}
                    </Text>
                )}
            </ThemeText>
            <Tag tagName={item.platform} />
            <IconButton
                style={{ marginLeft: rpx(14) }}
                name="x-mark"
                sizeType="small"
                onPress={() => {
                    if (isPlayLater) {
                        TrackPlayer.removePlayLater(item);
                    } else {
                        TrackPlayer.remove(item);
                    }
                }}
            />
        </Pressable>
    );
}

const PlayListItem = React.memo(
    PlayListItemView,
    (prev, next) =>
        !!isSameMediaItem(prev.item, next.item) &&
        prev.item.title === next.item.title &&
        prev.item.artist === next.item.artist &&
        prev.item.album === next.item.album &&
        prev.item.artwork === next.item.artwork &&
        prev.item.platform === next.item.platform &&
        prev.isCurrentMusic === next.isCurrentMusic &&
        prev.isPlayLater === next.isPlayLater,
);

interface IBodyProps {
    loading?: boolean;
}
export default function Body(props: IBodyProps) {
    const { loading } = props;
    const playList = usePlayList();
    const playLaterQueue = usePlayLaterQueue();
    const currentMusicItem = useCurrentMusic();
    const { t } = useI18N();
    const listRef = useRef<FlashListRef<IPlayListRow> | null>(null);
    const safeAreaInsets = useSafeAreaInsets();

    const listData = useMemo<IPlayListRow[]>(() => {
        const rows: IPlayListRow[] = [];
        if (playLaterQueue.length) {
            rows.push({
                type: "header",
                key: "play-later-header",
                title: t("playLater.title"),
                count: playLaterQueue.length,
                onClear: () => {
                    TrackPlayer.clearPlayLaterQueue();
                },
            });
            playLaterQueue.forEach(item => {
                rows.push({
                    type: "later",
                    key: `later:${getMediaUniqueKey(item)}`,
                    item,
                });
            });
            rows.push({
                type: "header",
                key: "playlist-header",
                title: t("panel.playList.title"),
                count: playList.length,
            });
        }
        playList.forEach(item => {
            rows.push({
                type: "normal",
                key: `normal:${getMediaUniqueKey(item)}`,
                item,
            });
        });
        return rows;
    }, [playLaterQueue, playList, t]);

    const initIndex = useMemo(() => {
        const index = listData.findIndex(row =>
            row.type === "normal" && isSameMediaItem(row.item, currentMusicItem),
        );
        return index === -1 ? undefined : index;
    }, [currentMusicItem, listData]);

    const renderItem = ({ item }: { item: IPlayListRow; index: number }) => {
        return item.type === "header" ? (
            <View style={style.sectionHeader}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    fontColor="textSecondary">
                    {item.title}
                    <ThemeText fontColor="textSecondary">
                        {t("panel.playList.count", { count: item.count })}
                    </ThemeText>
                </ThemeText>
                {item.onClear ? (
                    <IconButton
                        name="trash-outline"
                        sizeType="small"
                        onPress={item.onClear}
                    />
                ) : null}
            </View>
        ) : (
            <PlayListItem
                item={item.item}
                isCurrentMusic={!!isSameMediaItem(item.item, currentMusicItem)}
                isPlayLater={item.type === "later"}
            />
        );
    };

    return loading ? (
        <Loading />
    ) : (
        <View
            style={[
                style.playList,
                {
                    paddingBottom: safeAreaInsets.bottom,
                },
            ]}>
            <FlashList
                ref={_ => {
                    listRef.current = _;
                }}
                extraData={{ currentMusicItem }}
                data={listData}
                initialScrollIndex={initIndex}
                keyExtractor={item => item.key}
                renderItem={renderItem}
            />
        </View>
    );
}

const style = StyleSheet.create({
    playList: {
        width: rpx(750),
        flex: 1,
    },
    currentPlaying: {
        marginRight: rpx(6),
    },
    sectionHeader: {
        width: ITEM_WIDTH,
        height: rpx(72),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    musicItem: {
        width: ITEM_WIDTH,
        height: ITEM_HEIGHT,
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
    },
    musicItemTitle: {
        flex: 1,
    },
});
