import React, { useEffect, useMemo, useState } from "react";
import Clipboard from "@react-native-clipboard/clipboard";
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
import Toast from "@/utils/toast";

type LocalMusicFileStatus = "exists" | "missing" | "unknown" | "unavailable";
type LocalMusicFileStatusFilter = "all" | "exists" | "missing" | "unknown";

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

function buildLocalMusicMissingFilesReport(params: {
    items: IMusic.IMusicItem[];
    sourceFilterTitle: string;
    artistFilterTitle: string;
    albumFilterTitle: string;
    t: ReturnType<typeof useI18N>["t"];
}) {
    const {
        items,
        sourceFilterTitle,
        artistFilterTitle,
        albumFilterTitle,
        t,
    } = params;
    const records = items.map((musicItem, index) => [
        `#${index + 1}`,
        `${t("localMusic.report.song")}: ${
            musicItem.title || t("common.unknownName")
        }`,
        `${t("localMusic.report.artist")}: ${
            musicItem.artist || t("common.unknownName")
        }`,
        `${t("localMusic.report.album")}: ${musicItem.album || "-"}`,
        `${t("localMusic.report.source")}: ${musicItem.platform || "-"}`,
        `${t("localMusic.report.reason")}: ${t("localMusic.fileMissing")}`,
    ].join("\n"));

    return [
        t("localMusic.report.title"),
        `${t("localMusic.report.generatedAt")}: ${new Date().toISOString()}`,
        `${t("localMusic.report.count")}: ${items.length}`,
        `${t("localMusic.report.filterSource")}: ${sourceFilterTitle}`,
        `${t("localMusic.report.filterArtist")}: ${artistFilterTitle}`,
        `${t("localMusic.report.filterAlbum")}: ${albumFilterTitle}`,
        "",
        records.join("\n\n"),
    ].join("\n");
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
    const missingFileMusicList = useMemo(
        () =>
            artistAlbumFilteredMusicList.filter(
                musicItem =>
                    getLocalMusicFileStatus(musicItem, fileStatusMap) ===
                    "missing",
            ),
        [artistAlbumFilteredMusicList, fileStatusMap],
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

    function copyMissingFilesReport() {
        if (!missingFileMusicList.length) {
            Toast.warn(t("localMusic.noMissingFiles"));
            return;
        }

        Clipboard.setString(buildLocalMusicMissingFilesReport({
            items: missingFileMusicList,
            sourceFilterTitle,
            artistFilterTitle,
            albumFilterTitle,
            t,
        }));
        Toast.success(t("localMusic.copyMissingFilesReportSuccess", {
            count: missingFileMusicList.length,
        }));
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
                        key: "missing-files-report",
                        title: t("localMusic.copyMissingFilesReport"),
                        selected: false,
                        onPress: copyMissingFilesReport,
                        icon: "document-outline",
                    })}
                </ScrollView>
                {artistAlbumFilteredMusicList.length ? (
                    <View style={style.summary}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary">
                            {t("localMusic.fileStatusSummary", fileStatusStats)}
                        </ThemeText>
                    </View>
                ) : null}
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
    summary: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(16),
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
