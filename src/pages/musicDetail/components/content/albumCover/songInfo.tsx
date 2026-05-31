import React, { useCallback, useMemo } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Icon from "@/components/base/icon.tsx";
import Tag from "@/components/base/tag";
import { showPanel } from "@/components/panels/usePanel";
import {
    fontSizeConst,
    fontWeightConst,
    iconSizeConst,
} from "@/constants/uiConst";
import MusicSheet, { useFavorite } from "@/core/musicSheet";
import pluginManager from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useCurrentMusic } from "@/core/trackPlayer";
import rpx from "@/utils/rpx";

interface ISongInfoProps {
    showHeart?: boolean;
}

interface ISingerInfo {
    id: number | string;
    mid?: string;
    name: string;
    avatar?: string;
}

const INFO_MAX_WIDTH = rpx(500);
const INFO_HORIZONTAL_GUTTER = rpx(48);

export function getSongInfoWidth(windowWidth: number) {
    return Math.min(
        INFO_MAX_WIDTH,
        Math.max(rpx(280), windowWidth - INFO_HORIZONTAL_GUTTER),
    );
}

function getSingerList(musicItem: IMusic.IMusicItem | null): ISingerInfo[] {
    const item = musicItem as any;
    if (!Array.isArray(item?.singerList)) {
        return [];
    }
    return item.singerList
        .filter(
            (singer: Partial<ISingerInfo>) =>
                singer?.id !== undefined && singer?.id !== null && singer?.name,
        )
        .map((singer: Partial<ISingerInfo>) => ({
            id: singer.id!,
            mid: singer.mid,
            name: singer.name!,
            avatar: singer.avatar,
        }));
}

function getAlbumIdentity(musicItem: IMusic.IMusicItem) {
    const item = musicItem as any;
    const albumId = item.albumid ?? item.albumId ?? item.album_id;
    const albumMID = item.albummid ?? item.albumMID ?? item.album_mid;
    const normalizedId =
        albumId === undefined || albumId === null ? "" : String(albumId).trim();
    const normalizedMID =
        albumMID === undefined || albumMID === null
            ? ""
            : String(albumMID).trim();

    return {
        id: normalizedId,
        albumMID: normalizedMID,
    };
}

function shouldUseAlbumSearchFallback(
    musicItem: IMusic.IMusicItem,
    plugin?: ReturnType<typeof pluginManager.getByMedia>,
) {
    const platformNames = [
        musicItem.platform,
        (musicItem as any).originPlatform,
        plugin?.name,
        plugin?.instance?.platform,
    ]
        .filter(Boolean)
        .map(name => String(name));

    return platformNames.some(name => name.includes("GD聚合音乐"));
}

export default function SongInfo(props: ISongInfoProps) {
    const { showHeart = false } = props;
    const musicItem = useCurrentMusic();
    const isFavorite = useFavorite(musicItem);
    const navigate = useNavigate();
    const { width: windowWidth } = useWindowDimensions();

    const singerList = useMemo(() => getSingerList(musicItem), [musicItem]);
    const infoWidth = useMemo(
        () => getSongInfoWidth(windowWidth),
        [windowWidth],
    );

    const handleArtistPress = useCallback(() => {
        if (!musicItem?.artist || singerList.length === 0) {
            return;
        }

        const plugin = pluginManager.getByMedia(musicItem);
        if (!plugin) {
            return;
        }

        if (singerList.length === 1) {
            const singer = singerList[0];
            const artistItem: IArtist.IArtistItemBase = {
                id: String(singer.id),
                singerMID: singer.mid,
                name: singer.name,
                platform: musicItem.platform,
                avatar: singer.avatar || "",
                worksNum: 0,
            };

            navigate(ROUTE_PATH.ARTIST_DETAIL, {
                artistItem,
                pluginHash: plugin.hash ?? "",
            });
        } else {
            showPanel("ArtistSelectPanel", {
                singerList,
                platform: musicItem.platform,
            });
        }
    }, [musicItem, navigate, singerList]);

    const handleAlbumPress = useCallback(() => {
        if (!musicItem?.album) {
            return;
        }

        const plugin = pluginManager.getByMedia(musicItem);
        const albumIdentity = getAlbumIdentity(musicItem);
        const canOpenAlbumDetail =
            !!plugin?.supportedMethods.has("getAlbumInfo") &&
            !!(albumIdentity.id || albumIdentity.albumMID) &&
            !shouldUseAlbumSearchFallback(musicItem, plugin);

        if (canOpenAlbumDetail) {
            const albumItem: IAlbum.IAlbumItem = {
                id: albumIdentity.id || albumIdentity.albumMID,
                albumMID: albumIdentity.albumMID,
                title: musicItem.album,
                platform: musicItem.platform,
                artwork: musicItem.artwork,
                artist: musicItem.artist,
                description: "",
                musicList: [],
            };

            navigate(ROUTE_PATH.ALBUM_DETAIL, {
                albumItem,
                pluginHash: plugin?.hash,
            });
            return;
        }

        navigate(ROUTE_PATH.SEARCH_PAGE, {
            initialQuery: musicItem.album,
            initialSearchType: "album",
            pluginHash: plugin?.methods?.search ? plugin.hash : undefined,
        });
    }, [musicItem, navigate]);

    if (!musicItem) {
        return null;
    }

    return (
        <View style={[styles.container, { width: infoWidth }]}>
            <View style={styles.titleRow}>
                <Text numberOfLines={2} style={styles.title}>
                    {musicItem.title || "--"}
                </Text>
                {showHeart ? (
                    <Icon
                        name={isFavorite ? "heart" : "heart-outline"}
                        size={iconSizeConst.normal}
                        color={isFavorite ? "red" : "white"}
                        onPress={() => {
                            if (isFavorite) {
                                MusicSheet.removeMusic(
                                    MusicSheet.defaultSheet.id,
                                    musicItem,
                                );
                            } else {
                                MusicSheet.addMusic(
                                    MusicSheet.defaultSheet.id,
                                    musicItem,
                                );
                            }
                        }}
                    />
                ) : null}
            </View>
            <View style={styles.artistRow}>
                <Pressable
                    disabled={singerList.length === 0}
                    onPress={handleArtistPress}
                    style={({ pressed }) => [
                        styles.clickableContainer,
                        pressed ? styles.pressed : null,
                    ]}>
                    <Text numberOfLines={1} style={styles.artist}>
                        {musicItem.artist || "--"}
                    </Text>
                </Pressable>
                {musicItem.platform ? (
                    <Tag
                        tagName={musicItem.platform}
                        containerStyle={styles.tagBg}
                        style={styles.tagText}
                    />
                ) : null}
            </View>
            {musicItem.album ? (
                <Pressable
                    onPress={handleAlbumPress}
                    style={({ pressed }) => [
                        styles.clickableContainer,
                        pressed ? styles.pressed : null,
                    ]}>
                    <Text numberOfLines={1} style={styles.album}>
                        {musicItem.album}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "center",
        paddingVertical: rpx(18),
        alignItems: "flex-start",
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        width: "100%",
        marginBottom: rpx(16),
    },
    title: {
        color: "white",
        fontSize: fontSizeConst.title,
        fontWeight: fontWeightConst.semibold,
        includeFontPadding: false,
        textAlign: "left",
        flex: 1,
        marginRight: rpx(16),
    },
    artistRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: rpx(8),
        maxWidth: "100%",
    },
    artist: {
        color: "white",
        fontSize: fontSizeConst.subTitle,
        includeFontPadding: false,
        opacity: 0.9,
    },
    clickableContainer: {
        maxWidth: "100%",
        flexShrink: 1,
    },
    pressed: {
        opacity: 0.6,
    },
    tagBg: {
        backgroundColor: "rgba(255, 255, 255, 0.2)",
        marginLeft: rpx(12),
    },
    tagText: {
        color: "white",
    },
    album: {
        width: "100%",
        color: "white",
        fontSize: fontSizeConst.content,
        includeFontPadding: false,
        opacity: 0.7,
    },
});
