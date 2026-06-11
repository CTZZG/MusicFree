import React, { useEffect, useMemo, useState } from "react";
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
import { exists } from "react-native-fs";
import { removeFileScheme } from "@/utils/fileUtils";
import { getLocalPath, getMediaUniqueKey } from "@/utils/mediaUtils";

type LocalMusicFileStatus = "exists" | "missing" | "unknown" | "unavailable";
type LocalMusicFileStatusFilter = "all" | "exists" | "missing" | "unknown";
type LocalMusicSortMode = "default" | "title" | "artist" | "album" | "source";

function normalizeLocalMusicFsPath(filePath: string) {
    const rawPath = removeFileScheme(filePath);
    try {
        return decodeURI(rawPath);
    } catch {
        return rawPath;
    }
}

async function resolveLocalMusicFileStatus(
    musicItem: IMusic.IMusicItem,
): Promise<LocalMusicFileStatus> {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return "unavailable";
    }
    if (localPath.startsWith("content://")) {
        return "unknown";
    }
    const fsPath = normalizeLocalMusicFsPath(localPath);
    const fileExists = await exists(fsPath).catch(() => false);
    return fileExists ? "exists" : "missing";
}

function getLocalMusicFileStatus(
    musicItem: IMusic.IMusicItem,
    fileStatusMap: Record<string, LocalMusicFileStatus>,
) {
    const key = getMediaUniqueKey(musicItem);
    return fileStatusMap[key] ?? "unknown";
}

function matchLocalMusicFileStatusFilter(
    musicItem: IMusic.IMusicItem,
    fileStatusMap: Record<string, LocalMusicFileStatus>,
    filter: LocalMusicFileStatusFilter,
) {
    if (filter === "all") {
        return true;
    }
    const status = getLocalMusicFileStatus(musicItem, fileStatusMap);
    if (filter === "unknown") {
        return status === "unknown" || status === "unavailable";
    }
    return status === filter;
}

function compareLocalMusicText(left?: string | null, right?: string | null) {
    return `${left ?? ""}`.localeCompare(`${right ?? ""}`);
}

function sortLocalMusicItems(
    items: IMusic.IMusicItem[],
    sortMode: LocalMusicSortMode,
) {
    if (sortMode === "default") {
        return items;
    }

    return [...items].sort((a, b) => {
        if (sortMode === "title") {
            return (
                compareLocalMusicText(a.title, b.title) ||
                compareLocalMusicText(a.artist, b.artist)
            );
        }
        if (sortMode === "artist") {
            return (
                compareLocalMusicText(a.artist, b.artist) ||
                compareLocalMusicText(a.title, b.title)
            );
        }
        if (sortMode === "album") {
            return (
                compareLocalMusicText(a.album, b.album) ||
                compareLocalMusicText(a.title, b.title)
            );
        }
        return (
            compareLocalMusicText(a.platform, b.platform) ||
            compareLocalMusicText(a.title, b.title)
        );
    });
}

export default function LocalMusicList() {
    const musicList = LocalMusicSheet.useMusicList();
    const { t } = useI18N();
    const colors = useColors();
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [artistFilter, setArtistFilter] = useState<string>("all");
    const [albumFilter, setAlbumFilter] = useState<string>("all");
    const [fileStatusFilter, setFileStatusFilter] =
        useState<LocalMusicFileStatusFilter>("all");
    const [sortMode, setSortMode] = useState<LocalMusicSortMode>("default");
    const [fileStatusMap, setFileStatusMap] = useState<
        Record<string, LocalMusicFileStatus>
    >({});

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
    const artistAlbumFilteredMusicList = useMemo(
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
    const fileStatusStats = useMemo(
        () => {
            const stats = {
                exists: 0,
                missing: 0,
                unknown: 0,
            };
            artistAlbumFilteredMusicList.forEach(musicItem => {
                const status = getLocalMusicFileStatus(
                    musicItem,
                    fileStatusMap,
                );
                if (status === "exists") {
                    stats.exists += 1;
                } else if (status === "missing") {
                    stats.missing += 1;
                } else {
                    stats.unknown += 1;
                }
            });
            return stats;
        },
        [artistAlbumFilteredMusicList, fileStatusMap],
    );
    const filteredMusicList = useMemo(
        () =>
            artistAlbumFilteredMusicList.filter(musicItem =>
                matchLocalMusicFileStatusFilter(
                    musicItem,
                    fileStatusMap,
                    fileStatusFilter,
                ),
        ),
        [artistAlbumFilteredMusicList, fileStatusMap, fileStatusFilter],
    );
    const sortedMusicList = useMemo(
        () => sortLocalMusicItems(filteredMusicList, sortMode),
        [filteredMusicList, sortMode],
    );
    const sourceFilterTitle =
        sourceFilter === "all" ? t("localMusic.sourceFilter.all") : sourceFilter;
    const artistFilterTitle =
        artistFilter === "all" ? t("localMusic.artistFilter.all") : artistFilter;
    const albumFilterTitle =
        albumFilter === "all" ? t("localMusic.albumFilter.all") : albumFilter;
    const fileStatusFilterItems: Array<{
        key: LocalMusicFileStatusFilter;
        title: string;
    }> = [
        {
            key: "all",
            title: t("localMusic.fileStatusFilter.all"),
        },
        {
            key: "exists",
            title: t("localMusic.fileStatusFilter.exists"),
        },
        {
            key: "missing",
            title: t("localMusic.fileStatusFilter.missing"),
        },
        {
            key: "unknown",
            title: t("localMusic.fileStatusFilter.unknown"),
        },
    ];
    const fileStatusFilterTitle =
        fileStatusFilter === "all"
            ? t("localMusic.fileStatusFilter.title")
            : fileStatusFilterItems.find(item => item.key === fileStatusFilter)
                ?.title ?? t("localMusic.fileStatusFilter.title");
    const sortItems: Array<{
        key: LocalMusicSortMode;
        title: string;
    }> = [
        {
            key: "default",
            title: t("localMusic.sort.default"),
        },
        {
            key: "title",
            title: t("localMusic.sort.byTitle"),
        },
        {
            key: "artist",
            title: t("localMusic.sort.byArtist"),
        },
        {
            key: "album",
            title: t("localMusic.sort.byAlbum"),
        },
        {
            key: "source",
            title: t("localMusic.sort.bySource"),
        },
    ];
    const sortTitle =
        sortMode === "default"
            ? t("localMusic.sort.title")
            : sortItems.find(item => item.key === sortMode)?.title ??
                t("localMusic.sort.title");
    const hasActiveListControls =
        sourceFilter !== "all" ||
        artistFilter !== "all" ||
        albumFilter !== "all" ||
        fileStatusFilter !== "all" ||
        sortMode !== "default";

    useEffect(() => {
        let cancelled = false;
        const initialStatusMap: Record<string, LocalMusicFileStatus> = {};

        musicList.forEach(musicItem => {
            initialStatusMap[getMediaUniqueKey(musicItem)] = "unknown";
        });
        setFileStatusMap(prev => {
            const next = { ...initialStatusMap };
            Object.keys(next).forEach(key => {
                if (prev[key]) {
                    next[key] = prev[key];
                }
            });
            return next;
        });

        Promise.all(
            musicList.map(async musicItem => [
                getMediaUniqueKey(musicItem),
                await resolveLocalMusicFileStatus(musicItem),
            ] as const),
        ).then(entries => {
            if (!cancelled) {
                setFileStatusMap(Object.fromEntries(entries));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [musicList]);

    function showFilterSelect(
        header: string,
        candidates: string[],
        onSelect: (value: string) => void,
        allTitle: string,
    ) {
        showPanel("SimpleSelect", {
            header,
            candidates: candidates.map(candidate => ({
                title:
                    candidate === "all"
                        ? allTitle
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
        setFileStatusFilter("all");
    }

    function handleArtistPress() {
        showFilterSelect(
            t("common.artist"),
            artistFilters,
            setArtistFilter,
            t("localMusic.artistFilter.all"),
        );
    }

    function handleAlbumPress() {
        showFilterSelect(
            t("common.album"),
            albumFilters,
            setAlbumFilter,
            t("localMusic.albumFilter.all"),
        );
    }

    function handleFileStatusPress() {
        showPanel("SimpleSelect", {
            header: t("localMusic.fileStatusFilter.title"),
            candidates: fileStatusFilterItems.map(item => ({
                title: item.title,
                value: item.key,
                icon: "folder-outline",
            })),
            onPress(item) {
                setFileStatusFilter(item.value as LocalMusicFileStatusFilter);
            },
        });
    }

    function handleSortPress() {
        showPanel("SimpleSelect", {
            header: t("localMusic.sort.title"),
            candidates: sortItems.map(item => ({
                title: item.title,
                value: item.key,
                icon: sortMode === item.key ? "check" : "sort-outline",
            })),
            onPress(item) {
                setSortMode(item.value as LocalMusicSortMode);
            },
        });
    }

    function clearListControls() {
        setSourceFilter("all");
        setArtistFilter("all");
        setAlbumFilter("all");
        setFileStatusFilter("all");
        setSortMode("default");
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
                            title: source === "all"
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
                    {renderFilterChip({
                        key: "file-status-filter",
                        title: fileStatusFilterTitle,
                        selected: fileStatusFilter !== "all",
                        onPress: handleFileStatusPress,
                        icon: "folder-outline",
                    })}
                    {renderFilterChip({
                        key: "sort",
                        title: sortTitle,
                        selected: sortMode !== "default",
                        onPress: handleSortPress,
                        icon: "sort-outline",
                    })}
                    {hasActiveListControls
                        ? renderFilterChip({
                            key: "clear-filters",
                            title: t("localMusic.clearFilters"),
                            selected: false,
                            onPress: clearListControls,
                            icon: "x-mark",
                        })
                        : null}
                </ScrollView>
                {musicList.length ? (
                    <View style={style.summary}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary">
                            {t("localMusic.librarySummary", {
                                shown: sortedMusicList.length,
                                total: musicList.length,
                            })}
                        </ThemeText>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary">
                            {t("localMusic.fileStatusSummary", fileStatusStats)}
                        </ThemeText>
                    </View>
                ) : null}
                <MusicList
                    musicList={sortedMusicList}
                    showIndex
                    state={RequestStateCode.IDLE}
                    musicSheet={{
                        id: localMusicSheetId,
                        title: t("common.local"),
                        platform: localPluginPlatform,
                        musicList: sortedMusicList,
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
    summary: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(16),
        gap: rpx(8),
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
