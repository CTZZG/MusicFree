import React, { useMemo, useState } from "react";
import MusicList from "@/components/musicList";
import LocalMusicSheet from "@/core/localMusicSheet";
import { localMusicSheetId, localPluginPlatform, RequestStateCode } from "@/constants/commonConst";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import Color from "color";
import { showPanel } from "@/components/panels/usePanel";
import Icon, { IIconName } from "@/components/base/icon";

export default function LocalMusicList() {
    const musicList = LocalMusicSheet.useMusicList();
    const { t } = useI18N();
    const colors = useColors();
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [artistFilter, setArtistFilter] = useState<string>("all");
    const [albumFilter, setAlbumFilter] = useState<string>("all");

    const sourceFilters = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    musicList
                        .map(musicItem => musicItem.platform)
                        .filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [musicList],
    );
    const sourceFilteredMusicList = useMemo(
        () =>
            sourceFilter === "all"
                ? musicList
                : musicList.filter(
                    musicItem => musicItem.platform === sourceFilter,
                ),
        [musicList, sourceFilter],
    );
    const artistFilters = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    sourceFilteredMusicList
                        .map(musicItem => musicItem.artist)
                        .filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [sourceFilteredMusicList],
    );
    const albumFilters = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    sourceFilteredMusicList
                        .map(musicItem => musicItem.album)
                        .filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [sourceFilteredMusicList],
    );
    const filteredMusicList = useMemo(
        () =>
            sourceFilteredMusicList.filter(musicItem => {
                if (artistFilter !== "all" && musicItem.artist !== artistFilter) {
                    return false;
                }
                if (albumFilter !== "all" && musicItem.album !== albumFilter) {
                    return false;
                }
                return true;
            }),
        [sourceFilteredMusicList, artistFilter, albumFilter],
    );
    const artistFilterTitle =
        artistFilter === "all" ? t("localMusic.artistFilter.all") : artistFilter;
    const albumFilterTitle =
        albumFilter === "all" ? t("localMusic.albumFilter.all") : albumFilter;

    function showFilterSelect(
        header: string,
        candidates: string[],
        onSelect: (value: string) => void,
    ) {
        showPanel("SimpleSelect", {
            header,
            candidates: candidates.map(candidate => ({
                title:
                    candidate === "all"
                        ? header === t("common.artist")
                            ? t("localMusic.artistFilter.all")
                            : t("localMusic.albumFilter.all")
                        : candidate,
                value: candidate,
            })),
            onPress(item) {
                onSelect(item.value);
            },
        });
    }

    function renderFilterChip(props: {
        key: string;
        title: string;
        selected: boolean;
        onPress: () => void;
        icon?: IIconName;
    }) {
        const { key, title, selected, onPress, icon } = props;
        return (
            <Pressable
                key={key}
                style={[
                    style.filterChip,
                    {
                        backgroundColor: selected
                            ? Color(colors.primary)
                                .alpha(0.18)
                                .toString()
                            : colors.placeholder,
                        borderColor: selected
                            ? colors.primary
                            : Color(colors.text)
                                .alpha(0.06)
                                .toString(),
                    },
                ]}
                onPress={onPress}>
                <View style={style.filterChipContent}>
                    {icon ? (
                        <Icon
                            name={icon}
                            size={rpx(28)}
                            color={selected ? colors.primary : colors.text}
                            style={style.filterChipIcon}
                        />
                    ) : null}
                    <ThemeText
                        numberOfLines={1}
                        fontSize="description"
                        fontWeight="semibold"
                        color={selected ? colors.primary : colors.text}>
                        {title}
                    </ThemeText>
                </View>
            </Pressable>
        );
    }

    function handleSourceChange(source: string) {
        setSourceFilter(source);
        setArtistFilter("all");
        setAlbumFilter("all");
    }

    function handleArtistPress() {
        showFilterSelect(
            t("common.artist"),
            artistFilters,
            setArtistFilter,
        );
    }

    function handleAlbumPress() {
        showFilterSelect(
            t("common.album"),
            albumFilters,
            setAlbumFilter,
        );
    }

    return (
        <HorizontalSafeAreaView style={globalStyle.flex1}>
            <View style={globalStyle.flex1}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterBar}>
                    {sourceFilters.map(source =>
                        renderFilterChip({
                            key: `source-${source}`,
                            title:
                                source === "all"
                                    ? t("localMusic.sourceFilter.all")
                                    : source,
                            selected: sourceFilter === source,
                            onPress: () => handleSourceChange(source),
                        }),
                    )}
                    {renderFilterChip({
                        key: "artist-filter",
                        title: artistFilterTitle,
                        selected: artistFilter !== "all",
                        onPress: handleArtistPress,
                        icon: "user",
                    })}
                    {renderFilterChip({
                        key: "album-filter",
                        title: albumFilterTitle,
                        selected: albumFilter !== "all",
                        onPress: handleAlbumPress,
                        icon: "album-outline",
                    })}
                </ScrollView>
                <MusicList
                    musicList={filteredMusicList}
                    showIndex
                    state={RequestStateCode.IDLE}
                    musicSheet={{
                        id: localMusicSheetId,
                        title: t("common.local"),
                        platform: localPluginPlatform,
                        musicList: filteredMusicList,
                    }}
                />
            </View>
        </HorizontalSafeAreaView>
    );
}

const style = StyleSheet.create({
    filterBar: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    filterChip: {
        height: rpx(56),
        paddingHorizontal: rpx(18),
        borderRadius: rpx(28),
        borderWidth: StyleSheet.hairlineWidth,
        marginRight: rpx(12),
        alignItems: "center",
        justifyContent: "center",
    },
    filterChipContent: {
        flexDirection: "row",
        alignItems: "center",
    },
    filterChipIcon: {
        marginRight: rpx(8),
    },
});
