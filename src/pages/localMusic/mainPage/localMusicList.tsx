import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { exists } from "react-native-fs";

import Icon, { IIconName } from "@/components/base/icon";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import MusicList from "@/components/musicList";
import { localMusicSheetId, localPluginPlatform, RequestStateCode } from "@/constants/commonConst";
import globalStyle from "@/constants/globalStyle";
import LocalMusicSheet from "@/core/localMusicSheet";
import { useI18N } from "@/core/i18n";
import TrackPlayer, { useCurrentMusic } from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import { getLocalPath, getMediaUniqueKey } from "@/utils/mediaUtils";
import { removeFileScheme } from "@/utils/fileUtils";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import Color from "color";
import shuffle from "@/utils/shuffle";

type LocalMusicFileStatus = "exists" | "missing" | "unknown" | "unavailable";
type LocalMusicSortMode = "default" | "title" | "artist" | "album" | "folder";
type LocalMusicViewMode =
    | "songs"
    | "artists"
    | "albums"
    | "folders"
    | "downloaded"
    | "missing"
    | "hidden";

interface IGroupItem {
    count: number;
    description: string;
    icon: IIconName;
    key: string;
    title: string;
    value: string;
}

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

function compareLocalMusicText(left?: string | null, right?: string | null) {
    return `${left ?? ""}`.localeCompare(`${right ?? ""}`, "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
    });
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
            compareLocalMusicText(
                LocalMusicSheet.getLocalMusicFolder(a),
                LocalMusicSheet.getLocalMusicFolder(b),
            ) || compareLocalMusicText(a.title, b.title)
        );
    });
}

function normalizeFacetValue(value?: string | null) {
    return `${value ?? ""}`.trim();
}

function isDownloadedLocalMusic(musicItem: IMusic.IMusicItem) {
    return musicItem.platform !== localPluginPlatform && !!getLocalPath(musicItem);
}

function buildGroupItems(
    musicList: IMusic.IMusicItem[],
    getValue: (musicItem: IMusic.IMusicItem) => string,
    fallbackTitle: string,
    icon: IIconName,
    descriptionPrefix: string,
) {
    const groupMap = new Map<string, IGroupItem>();
    musicList.forEach(musicItem => {
        const value = getValue(musicItem) || fallbackTitle;
        const current = groupMap.get(value);
        if (current) {
            current.count += 1;
        } else {
            groupMap.set(value, {
                count: 1,
                description: "",
                icon,
                key: value,
                title: value,
                value,
            });
        }
    });

    return [...groupMap.values()]
        .map(item => ({
            ...item,
            description: `${descriptionPrefix} · ${item.count}`,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
}

export default function LocalMusicList() {
    const musicList = LocalMusicSheet.useMusicList();
    const hiddenState = LocalMusicSheet.useHiddenState();
    const currentMusic = useCurrentMusic();
    const { t } = useI18N();
    const colors = useColors();
    const [viewMode, setViewMode] = useState<LocalMusicViewMode>("songs");
    const [artistFilter, setArtistFilter] = useState<string>("all");
    const [albumFilter, setAlbumFilter] = useState<string>("all");
    const [folderFilter, setFolderFilter] = useState<string>("all");
    const [sortMode, setSortMode] = useState<LocalMusicSortMode>("title");
    const [fileStatusMap, setFileStatusMap] = useState<
        Record<string, LocalMusicFileStatus>
    >({});

    const visibleMusicList = useMemo(
        () => musicList.filter(musicItem => !LocalMusicSheet.isHiddenMusic(musicItem)),
        [hiddenState, musicList],
    );
    const hiddenMusicList = useMemo(
        () => musicList.filter(musicItem => LocalMusicSheet.isHiddenMusic(musicItem)),
        [hiddenState, musicList],
    );

    const artistGroups = useMemo(
        () =>
            buildGroupItems(
                visibleMusicList,
                musicItem => normalizeFacetValue(musicItem.artist),
                t("localMusic.unknownArtist"),
                "user",
                t("localMusic.group.songCount"),
            ),
        [t, visibleMusicList],
    );
    const albumGroups = useMemo(
        () =>
            buildGroupItems(
                visibleMusicList,
                musicItem => normalizeFacetValue(musicItem.album),
                t("localMusic.unknownAlbum"),
                "album-outline",
                t("localMusic.group.songCount"),
            ),
        [t, visibleMusicList],
    );
    const folderGroups = useMemo(
        () =>
            buildGroupItems(
                visibleMusicList,
                musicItem => LocalMusicSheet.getLocalMusicFolder(musicItem),
                t("localMusic.unknownFolder"),
                "folder-outline",
                t("localMusic.group.songCount"),
            ),
        [t, visibleMusicList],
    );

    const fileStatusStats = useMemo(
        () => {
            const stats = {
                exists: 0,
                missing: 0,
                unknown: 0,
            };
            visibleMusicList.forEach(musicItem => {
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
        [visibleMusicList, fileStatusMap],
    );

    const downloadedCount = useMemo(
        () => visibleMusicList.filter(isDownloadedLocalMusic).length,
        [visibleMusicList],
    );
    const viewModeItems = useMemo(
        () => {
            const items: Array<{
                key: LocalMusicViewMode;
                title: string;
                count: number;
                icon: IIconName;
            }> = [
                {
                    key: "songs",
                    title: t("localMusic.view.songs"),
                    count: visibleMusicList.length,
                    icon: "musical-note",
                },
                {
                    key: "artists",
                    title: t("localMusic.view.artists"),
                    count: artistGroups.length,
                    icon: "user",
                },
                {
                    key: "albums",
                    title: t("localMusic.view.albums"),
                    count: albumGroups.length,
                    icon: "album-outline",
                },
                {
                    key: "folders",
                    title: t("localMusic.view.folders"),
                    count: folderGroups.length,
                    icon: "folder-outline",
                },
                {
                    key: "downloaded",
                    title: t("localMusic.view.downloaded"),
                    count: downloadedCount,
                    icon: "arrow-down-tray",
                },
                {
                    key: "missing",
                    title: t("localMusic.view.missing"),
                    count: fileStatusStats.missing,
                    icon: "exclamation-circle",
                },
            ];

            if (hiddenMusicList.length || hiddenState.hiddenFolders.length) {
                items.push({
                    key: "hidden",
                    title: t("localMusic.view.hidden"),
                    count: hiddenMusicList.length + hiddenState.hiddenFolders.length,
                    icon: "archive-box-x-mark",
                });
            }

            return items;
        },
        [
            albumGroups.length,
            artistGroups.length,
            downloadedCount,
            fileStatusStats.missing,
            folderGroups.length,
            hiddenMusicList.length,
            hiddenState.hiddenFolders.length,
            t,
            visibleMusicList.length,
        ],
    );
    const listBaseMusicList = useMemo(() => {
        if (viewMode === "downloaded") {
            return visibleMusicList.filter(isDownloadedLocalMusic);
        }
        if (viewMode === "missing") {
            return visibleMusicList.filter(
                musicItem =>
                    getLocalMusicFileStatus(musicItem, fileStatusMap) ===
                    "missing",
            );
        }
        if (viewMode === "hidden") {
            return hiddenMusicList;
        }
        return visibleMusicList;
    }, [fileStatusMap, hiddenMusicList, viewMode, visibleMusicList]);

    const filteredMusicList = useMemo(
        () =>
            listBaseMusicList.filter(musicItem => {
                if (
                    artistFilter !== "all" &&
                    normalizeFacetValue(musicItem.artist) !== artistFilter
                ) {
                    return false;
                }
                if (
                    albumFilter !== "all" &&
                    normalizeFacetValue(musicItem.album) !== albumFilter
                ) {
                    return false;
                }
                if (
                    folderFilter !== "all" &&
                    LocalMusicSheet.getLocalMusicFolder(musicItem) !== folderFilter
                ) {
                    return false;
                }
                return true;
            }),
        [albumFilter, artistFilter, folderFilter, listBaseMusicList],
    );
    const sortedMusicList = useMemo(
        () => sortLocalMusicItems(filteredMusicList, sortMode),
        [filteredMusicList, sortMode],
    );
    const isGroupMode =
        viewMode === "artists" ||
        viewMode === "albums" ||
        viewMode === "folders";
    const activeViewItem = useMemo(
        () => viewModeItems.find(item => item.key === viewMode),
        [viewMode, viewModeItems],
    );
    const currentDisplayCount = isGroupMode
        ? activeViewItem?.count ?? 0
        : sortedMusicList.length;
    const playableSortedMusicList = useMemo(
        () =>
            sortedMusicList.filter(
                musicItem =>
                    getLocalMusicFileStatus(musicItem, fileStatusMap) !==
                    "missing",
            ),
        [fileStatusMap, sortedMusicList],
    );

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
            key: "folder",
            title: t("localMusic.sort.byFolder"),
        },
    ];
    const sortTitle =
        sortMode === "default"
            ? t("localMusic.sort.title")
            : sortItems.find(item => item.key === sortMode)?.title ??
                t("localMusic.sort.title");
    const hasActiveListControls =
        artistFilter !== "all" ||
        albumFilter !== "all" ||
        folderFilter !== "all" ||
        sortMode !== "title";
    const shouldShowListSummary =
        hasActiveListControls ||
        viewMode !== "songs" ||
        fileStatusStats.missing > 0;

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

    function selectViewMode(nextViewMode: LocalMusicViewMode) {
        setViewMode(nextViewMode);
        setArtistFilter("all");
        setAlbumFilter("all");
        setFolderFilter("all");
    }

    function openGroup(
        filterType: "artist" | "album" | "folder",
        value: string,
    ) {
        setViewMode("songs");
        setArtistFilter(filterType === "artist" ? value : "all");
        setAlbumFilter(filterType === "album" ? value : "all");
        setFolderFilter(filterType === "folder" ? value : "all");
    }

    function clearListControls() {
        setArtistFilter("all");
        setAlbumFilter("all");
        setFolderFilter("all");
        setSortMode("title");
    }

    function playShuffledList() {
        if (isGroupMode || !playableSortedMusicList.length) {
            return;
        }

        const shuffledMusicList = shuffle(playableSortedMusicList);
        void TrackPlayer.playWithReplacePlayList(
            shuffledMusicList[0],
            shuffledMusicList,
        );
    }

    const getAlphabetIndexText = useCallback(
        (musicItem: IMusic.IMusicItem) => {
            if (sortMode === "artist") {
                return musicItem.artist;
            }
            if (sortMode === "album") {
                return musicItem.album;
            }
            if (sortMode === "folder") {
                return LocalMusicSheet.getLocalMusicFolder(musicItem);
            }
            return musicItem.title;
        },
        [sortMode],
    );

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

    function showViewSelect() {
        showPanel("SimpleSelect", {
            header: t("common.view"),
            candidates: viewModeItems.map(item => ({
                title: `${item.title} ${item.count}`,
                value: item.key,
                icon: viewMode === item.key ? "check" : item.icon,
            })),
            onPress(item) {
                selectViewMode(item.value as LocalMusicViewMode);
            },
        });
    }

    function renderLibraryToolbar() {
        const canShuffle = !isGroupMode && playableSortedMusicList.length > 0;
        const sortActive = sortMode !== "title";

        return (
            <View style={style.libraryToolbar}>
                <View style={style.libraryToolbarLeft}>
                    <Pressable
                        disabled={!canShuffle}
                        accessibilityLabel={t("repeatMode.SHUFFLE")}
                        style={style.toolbarIconButton}
                        onPress={playShuffledList}>
                        <Icon
                            name="shuffle"
                            size={rpx(34)}
                            color={canShuffle ? colors.text : colors.textSecondary}
                            opacity={canShuffle ? 1 : 0.35}
                        />
                    </Pressable>
                    <ThemeText
                        fontWeight="bold"
                        style={style.libraryToolbarCount}
                        numberOfLines={1}>
                        {currentDisplayCount}
                    </ThemeText>
                </View>
                <View style={style.libraryToolbarActions}>
                    {!isGroupMode ? (
                        <Pressable
                            accessibilityLabel={sortTitle}
                            style={style.toolbarIconButton}
                            onPress={showSortSelect}>
                            <Icon
                                name="sort-outline"
                                size={rpx(34)}
                                color={sortActive ? colors.primary : colors.text}
                            />
                        </Pressable>
                    ) : null}
                    <Pressable
                        accessibilityLabel={t("common.view")}
                        style={style.toolbarIconButton}
                        onPress={showViewSelect}>
                        <Icon
                            name="playlist"
                            size={rpx(36)}
                            color={colors.text}
                        />
                    </Pressable>
                </View>
            </View>
        );
    }

    function renderListControls() {
        const chips: React.ReactElement[] = [];

        if (artistFilter !== "all") {
            chips.push(renderFilterChip({
                key: "artist-filter",
                title: artistFilter,
                selected: true,
                onPress: () => setArtistFilter("all"),
                icon: "user",
            }));
        }
        if (albumFilter !== "all") {
            chips.push(renderFilterChip({
                key: "album-filter",
                title: albumFilter,
                selected: true,
                onPress: () => setAlbumFilter("all"),
                icon: "album-outline",
            }));
        }
        if (folderFilter !== "all") {
            chips.push(renderFilterChip({
                key: "folder-filter",
                title: folderFilter,
                selected: true,
                onPress: () => setFolderFilter("all"),
                icon: "folder-outline",
            }));
        }
        if (hasActiveListControls) {
            chips.push(renderFilterChip({
                key: "clear-filters",
                title: t("localMusic.clearFilters"),
                selected: false,
                onPress: clearListControls,
                icon: "x-mark",
            }));
        }

        if (!chips.length) {
            return null;
        }

        return (
            <ScrollView
                style={style.secondaryFilterScroll}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={style.secondaryFilterBar}>
                {chips}
            </ScrollView>
        );
    }

    function showSortSelect() {
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

    function renderGroupItem(
        item: IGroupItem,
        filterType: "artist" | "album" | "folder",
    ) {
        return (
            <ListItem
                withHorizontalPadding
                heightType="normal"
                onPress={() => openGroup(filterType, item.value)}>
                <ListItem.ListItemIcon icon={item.icon} />
                <ListItem.Content
                    title={item.title}
                    description={item.description}
                />
                {filterType === "folder" ? (
                    <ListItem.ListItemIcon
                        icon="archive-box-x-mark"
                        position="right"
                        onPress={() => {
                            showDialog("SimpleDialog", {
                                title: t("localMusic.hideFolder"),
                                content: t("localMusic.hideFolderConfirm", {
                                    folder: item.title,
                                }),
                                async onOk() {
                                    await LocalMusicSheet.hideFolder(item.value);
                                    Toast.success(t("localMusic.hideSuccess"));
                                },
                            });
                        }}
                    />
                ) : null}
            </ListItem>
        );
    }

    function renderGroupList(
        data: IGroupItem[],
        filterType: "artist" | "album" | "folder",
    ) {
        return (
            <FlatList
                data={data}
                keyExtractor={item => item.key}
                renderItem={({ item }) => renderGroupItem(item, filterType)}
                ListFooterComponent={<View style={style.listFooter} />}
            />
        );
    }

    function renderHiddenHeader() {
        if (!hiddenState.hiddenFolders.length) {
            return null;
        }

        return (
            <View>
                {hiddenState.hiddenFolders.map(folder => (
                    <ListItem
                        key={folder}
                        withHorizontalPadding
                        heightType="normal">
                        <ListItem.ListItemIcon icon="folder-outline" />
                        <ListItem.Content
                            title={folder}
                            description={t("localMusic.hiddenFolder")}
                        />
                        <ListItem.ListItemIcon
                            icon="x-mark"
                            position="right"
                            onPress={async () => {
                                await LocalMusicSheet.unhideFolder(folder);
                                Toast.success(t("localMusic.unhideSuccess"));
                            }}
                        />
                    </ListItem>
                ))}
            </View>
        );
    }

    return (
        <HorizontalSafeAreaView style={globalStyle.flex1}>
            <View style={globalStyle.flex1}>
                {renderLibraryToolbar()}
                {!isGroupMode ? renderListControls() : null}
                {musicList.length && shouldShowListSummary ? (
                    <View style={style.summary}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary">
                            {t("localMusic.librarySummary", {
                                shown: isGroupMode
                                    ? viewMode === "artists"
                                        ? artistGroups.length
                                        : viewMode === "albums"
                                            ? albumGroups.length
                                            : folderGroups.length
                                    : sortedMusicList.length,
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
                {viewMode === "artists" ? (
                    renderGroupList(artistGroups, "artist")
                ) : viewMode === "albums" ? (
                    renderGroupList(albumGroups, "album")
                ) : viewMode === "folders" ? (
                    renderGroupList(folderGroups, "folder")
                ) : (
                    <MusicList
                        Header={viewMode === "hidden" ? renderHiddenHeader : undefined}
                        musicList={sortedMusicList}
                        showArtwork
                        showQuality
                        showAddNextIcon
                        enableAlphabetIndex={viewMode === "songs"}
                        alphabetIndexText={getAlphabetIndexText}
                        highlightMusicItem={currentMusic}
                        state={RequestStateCode.IDLE}
                        musicSheet={{
                            id: localMusicSheetId,
                            title: t("common.local"),
                            platform: localPluginPlatform,
                            musicList: sortedMusicList,
                        }}
                    />
                )}
            </View>
        </HorizontalSafeAreaView>
    );
}

const style = StyleSheet.create({
    libraryToolbar: {
        flexGrow: 0,
        height: rpx(88),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    libraryToolbarLeft: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
    },
    libraryToolbarActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    toolbarIconButton: {
        width: rpx(64),
        height: rpx(64),
        alignItems: "center",
        justifyContent: "center",
    },
    libraryToolbarCount: {
        marginLeft: rpx(14),
        minWidth: rpx(72),
    },
    filterScroll: {
        flexGrow: 0,
        height: rpx(80),
        maxHeight: rpx(80),
    },
    filterBar: {
        paddingHorizontal: rpx(20),
        paddingTop: rpx(16),
        paddingBottom: rpx(8),
    },
    secondaryFilterScroll: {
        flexGrow: 0,
        height: rpx(68),
        maxHeight: rpx(68),
    },
    secondaryFilterBar: {
        paddingHorizontal: rpx(20),
        paddingTop: rpx(4),
        paddingBottom: rpx(8),
    },
    filterChip: {
        height: rpx(56),
        minWidth: rpx(96),
        maxWidth: rpx(260),
        paddingHorizontal: rpx(18),
        marginRight: rpx(12),
        borderRadius: rpx(6),
        borderWidth: StyleSheet.hairlineWidth,
        justifyContent: "center",
    },
    filterChipContent: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
    },
    filterChipIcon: {
        marginRight: rpx(8),
    },
    summary: {
        paddingHorizontal: rpx(28),
        paddingTop: rpx(4),
        paddingBottom: rpx(8),
    },
    listFooter: {
        height: rpx(160),
    },
});
