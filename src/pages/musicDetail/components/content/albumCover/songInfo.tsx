import React, { useCallback, useMemo } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import Tag from "@/components/base/tag";
import { showPanel } from "@/components/panels/usePanel";
import { fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import MusicSheet, { useFavorite } from "@/core/musicSheet";
import pluginManager from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useCurrentMusic } from "@/core/trackPlayer";
import { parseArtists } from "@/utils/artistParser";
import rpx from "@/utils/rpx";

interface ISongInfoProps {
    /** card：卡片封面下的标题区；hero：沉浸大图上的标题区 */
    variant?: "card" | "hero";
    /** 卡片式布局里与封面同宽，文字和封面两边对齐 */
    width?: number;
}

// iOS 系统粉，收藏后的爱心
const FAVORITE_COLOR = "#FF375F";

interface ISingerInfo {
    id?: number | string;
    mid?: string;
    name: string;
    avatar?: string;
    searchOnly?: boolean;
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
    if (Array.isArray(item?.singerList)) {
        const structuredSingers = item.singerList
            .filter(
                (singer: Partial<ISingerInfo>) =>
                    singer?.id !== undefined &&
                    singer?.id !== null &&
                    singer?.name,
            )
            .map((singer: Partial<ISingerInfo>) => ({
                id: singer.id!,
                mid: singer.mid,
                name: singer.name!,
                avatar: singer.avatar,
            }));

        if (structuredSingers.length > 0) {
            return structuredSingers;
        }
    }

    return parseArtists(musicItem?.artist).map(name => ({
        id: name,
        name,
        searchOnly: true,
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

function canOpenArtistDetail(
    singer: ISingerInfo,
    plugin?: ReturnType<typeof pluginManager.getByMedia>,
) {
    return (
        !singer.searchOnly &&
        singer.id !== undefined &&
        singer.id !== null &&
        !!plugin?.supportedMethods.has("getArtistWorks")
    );
}

export default function SongInfo(props: ISongInfoProps) {
    const { variant = "card", width } = props;
    const isHero = variant === "hero";
    const musicItem = useCurrentMusic();
    const navigate = useNavigate();
    const { t } = useI18N();
    const { width: windowWidth } = useWindowDimensions();

    const singerList = useMemo(() => getSingerList(musicItem), [musicItem]);
    const infoWidth = useMemo(
        () =>
            isHero
                ? Math.max(rpx(280), windowWidth - rpx(72))
                : width ?? getSongInfoWidth(windowWidth),
        [isHero, width, windowWidth],
    );

    const handleArtistPress = useCallback(() => {
        if (!musicItem?.artist || singerList.length === 0) {
            return;
        }

        const plugin = pluginManager.getByMedia(musicItem);

        if (singerList.length === 1) {
            const singer = singerList[0];
            if (!canOpenArtistDetail(singer, plugin)) {
                navigate(ROUTE_PATH.SEARCH_PAGE, {
                    initialQuery: singer.name,
                    initialSearchType: "artist",
                    pluginHash: plugin?.supportedMethods.has("search")
                        ? plugin.hash
                        : undefined,
                });
                return;
            }
            if (!plugin) {
                return;
            }

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
                pluginHash: plugin?.hash,
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
            pluginHash: plugin?.supportedMethods.has("search")
                ? plugin.hash
                : undefined,
        });
    }, [musicItem, navigate]);

    if (!musicItem) {
        return null;
    }

    return (
        <View
            style={[
                styles.container,
                isHero ? styles.heroContainer : null,
                { width: infoWidth },
            ]}>
            <View style={styles.row}>
                <View style={styles.texts}>
                    <Text
                        numberOfLines={1}
                        style={[styles.title, isHero ? styles.heroTitle : null]}>
                        {musicItem.title || "--"}
                    </Text>
                    <View style={styles.artistRow}>
                        <Pressable
                            disabled={singerList.length === 0}
                            onPress={handleArtistPress}
                            style={({ pressed }) => [
                                styles.clickableContainer,
                                pressed ? styles.pressed : null,
                            ]}>
                            <Text
                                numberOfLines={1}
                                style={[
                                    styles.artist,
                                    isHero ? styles.heroArtist : null,
                                ]}>
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
                    {musicItem.album && !isHero ? (
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
                <FavoriteButton musicItem={musicItem} />
                <RoundButton
                    icon="ellipsis-vertical"
                    accessibilityLabel={t("musicDetail.more.a11y")}
                    onPress={() => {
                        showPanel("MusicItemOptions", {
                            musicItem,
                            from: ROUTE_PATH.MUSIC_DETAIL,
                        });
                    }}
                />
            </View>
        </View>
    );
}

/** 标题右侧的圆形按钮（收藏、更多） */
function RoundButton(props: {
    icon: IIconName;
    color?: string;
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityState={props.accessibilityState}
            hitSlop={4}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.roundButton,
                pressed ? styles.pressed : null,
            ]}>
            <Icon name={props.icon} size={20} color={props.color ?? "white"} />
        </Pressable>
    );
}

function FavoriteButton(props: { musicItem: IMusic.IMusicItem }) {
    const { musicItem } = props;
    const isFavorite = useFavorite(musicItem);
    const { t } = useI18N();

    return (
        <RoundButton
            icon={isFavorite ? "heart" : "heart-outline"}
            color={isFavorite ? FAVORITE_COLOR : "white"}
            accessibilityLabel={t(
                isFavorite
                    ? "musicDetail.unfavorite.a11y"
                    : "musicDetail.favorite.a11y",
            )}
            accessibilityState={{ selected: isFavorite }}
            onPress={() => {
                if (isFavorite) {
                    MusicSheet.removeMusic(
                        MusicSheet.defaultSheet.id,
                        musicItem,
                    );
                } else {
                    MusicSheet.addMusic(MusicSheet.defaultSheet.id, musicItem);
                }
            }}
        />
    );
}

const styles = StyleSheet.create({
    container: {
        alignSelf: "center",
        paddingTop: 22,
        paddingBottom: 6,
    },
    heroContainer: {
        paddingTop: rpx(12),
        paddingBottom: rpx(8),
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    texts: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        color: "white",
        fontSize: 24,
        lineHeight: 30,
        fontWeight: fontWeightConst.bold,
        includeFontPadding: false,
    },
    heroTitle: {
        fontSize: rpx(40),
        lineHeight: rpx(48),
        textShadowColor: "rgba(0,0,0,0.22)",
        textShadowOffset: { width: 0, height: rpx(2) },
        textShadowRadius: rpx(6),
    },
    artistRow: {
        flexDirection: "row",
        alignItems: "center",
        maxWidth: "100%",
    },
    artist: {
        color: "rgba(255, 255, 255, 0.72)",
        fontSize: 20,
        lineHeight: 26,
        includeFontPadding: false,
    },
    heroArtist: {
        fontSize: rpx(24),
        lineHeight: rpx(34),
        color: "rgba(255, 255, 255, 0.86)",
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
        marginLeft: 8,
    },
    tagText: {
        color: "white",
    },
    album: {
        color: "rgba(255, 255, 255, 0.56)",
        fontSize: 15,
        lineHeight: 20,
        includeFontPadding: false,
    },
    roundButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255, 255, 255, 0.16)",
    },
});
