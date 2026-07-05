import Color from "color";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Input from "@/components/base/input";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import LocalMusicSheet from "@/core/localMusicSheet";
import MediaCache from "@/core/mediaCache";
import {
    DEFAULT_MEDIA_CACHE_QUALITY,
    filterMediaCacheEntries,
    getMediaCacheEntryKeys,
    getMediaCachePlatforms,
    getMediaCacheQualities,
} from "@/core/mediaCacheListPolicy";
import type { MediaCacheEntry } from "@/core/mediaCacheListPolicy";
import PluginManager from "@/core/pluginManager";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import { clearCache, getCacheSize, sizeFormatter } from "@/utils/fileUtils";
import { getQualityAbbr } from "@/utils/qualities";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

interface ICacheStats {
    playbackCacheCount: number;
    playbackCacheSize: number;
    lyricCacheSize: number;
    imageCacheSize: number;
    pluginCacheCount: number;
    localFileCount: number;
}

const initialStats: ICacheStats = {
    playbackCacheCount: 0,
    playbackCacheSize: 0,
    lyricCacheSize: 0,
    imageCacheSize: 0,
    pluginCacheCount: 0,
    localFileCount: 0,
};

export default function CacheManagementSetting() {
    const { t } = useI18N();
    const colors = useColors();
    const [stats, setStats] = useState<ICacheStats>(initialStats);
    const [cacheEntries, setCacheEntries] = useState<MediaCacheEntry[]>([]);
    const [query, setQuery] = useState("");
    const [platformFilter, setPlatformFilter] = useState("");
    const [qualityFilter, setQualityFilter] = useState("");

    const refreshStats = useCallback(async () => {
        const [mediaStats, musicCacheSize, lyricCacheSize, imageCacheSize] =
            await Promise.all([
                Promise.resolve(MediaCache.getMediaCacheStats()),
                getCacheSize("music"),
                getCacheSize("lyric"),
                getCacheSize("image"),
            ]);
        setStats({
            playbackCacheCount: mediaStats.count,
            playbackCacheSize: musicCacheSize + mediaStats.approximateSize,
            lyricCacheSize,
            imageCacheSize,
            pluginCacheCount: PluginManager.getPluginCacheCount(),
            localFileCount: LocalMusicSheet.getMusicList().length,
        });
        setCacheEntries(MediaCache.getMediaCacheEntries());
    }, []);

    const totalCacheSize =
        stats.playbackCacheSize + stats.lyricCacheSize + stats.imageCacheSize;
    const platforms = useMemo(
        () => getMediaCachePlatforms(cacheEntries),
        [cacheEntries],
    );
    const qualities = useMemo(
        () => getMediaCacheQualities(cacheEntries),
        [cacheEntries],
    );
    const filteredCacheEntries = useMemo(
        () =>
            filterMediaCacheEntries(cacheEntries, {
                platform: platformFilter,
                quality: qualityFilter,
                query,
            }),
        [cacheEntries, platformFilter, qualityFilter, query],
    );
    const hasActiveListControls = !!(
        platformFilter ||
        qualityFilter ||
        query.trim()
    );

    useEffect(() => {
        void refreshStats();
    }, [refreshStats]);

    useEffect(() => {
        if (platformFilter && !platforms.includes(platformFilter)) {
            setPlatformFilter("");
        }
    }, [platformFilter, platforms]);

    useEffect(() => {
        if (qualityFilter && !qualities.includes(qualityFilter)) {
            setQualityFilter("");
        }
    }, [qualityFilter, qualities]);

    function clearListControls() {
        setQuery("");
        setPlatformFilter("");
        setQualityFilter("");
    }

    function showClearPlaybackCacheDialog() {
        showDialog("SimpleDialog", {
            title: t("cacheManagement.clearPlaybackCache"),
            content: t("cacheManagement.clearPlaybackCacheConfirm"),
            async onOk() {
                await Promise.all([
                    clearCache("music"),
                    MediaCache.clearAllMediaCache(),
                ]);
                await refreshStats();
                Toast.success(t("cacheManagement.cacheCleared"));
            },
        });
    }

    function showClearPluginCacheDialog() {
        showDialog("SimpleDialog", {
            title: t("cacheManagement.clearPluginCache"),
            content: t("dialog.clearPluginCacheContent"),
            async onOk() {
                PluginManager.clearPluginCache();
                await refreshStats();
                Toast.success(t("toast.pluginCacheCleared"));
            },
        });
    }

    function showClearAllSafeCachesDialog() {
        showDialog("SimpleDialog", {
            title: t("cacheManagement.clearAllSafeCaches"),
            content: t("cacheManagement.clearAllSafeCachesConfirm"),
            async onOk() {
                await Promise.all([
                    clearCache("music"),
                    clearCache("lyric"),
                    clearCache("image"),
                    MediaCache.clearAllMediaCache(),
                ]);
                PluginManager.clearPluginCache();
                await refreshStats();
                Toast.success(t("cacheManagement.allSafeCachesCleared"));
            },
        });
    }

    function showClearCacheEntryDialog(entry: MediaCacheEntry) {
        const displayTitle = entry.title || entry.key;
        showDialog("SimpleDialog", {
            title: t("cacheManagement.clearEntry"),
            content: t("cacheManagement.clearEntryConfirm", {
                title: displayTitle,
            }),
            async onOk() {
                await MediaCache.removeMediaCacheEntry(entry.key);
                await refreshStats();
                Toast.success(t("cacheManagement.entryCleared"));
            },
        });
    }

    function showClearFilteredCacheEntriesDialog() {
        const keys = getMediaCacheEntryKeys(filteredCacheEntries);
        if (!keys.length) {
            return;
        }
        showDialog("SimpleDialog", {
            title: t("cacheManagement.clearFilteredEntries"),
            content: t("cacheManagement.clearFilteredEntriesConfirm", {
                count: keys.length,
            }),
            async onOk() {
                const count = await MediaCache.removeMediaCacheEntries(keys);
                await refreshStats();
                Toast.success(t("cacheManagement.filteredEntriesCleared", {
                    count,
                }));
            },
        });
    }

    function getCacheEntryDescription(entry: MediaCacheEntry) {
        return [
            entry.artist,
            entry.album,
            getCacheEntryQualitySummary(entry),
            `${entry.platform}@${entry.id}`,
        ].filter(Boolean).join(" · ");
    }

    function formatQualityLabel(quality: string) {
        return quality === DEFAULT_MEDIA_CACHE_QUALITY
            ? t("cacheManagement.quality.default")
            : getQualityAbbr(quality);
    }

    function getCacheEntryQualitySummary(entry: MediaCacheEntry) {
        if (!entry.qualityKeys.length) {
            return "";
        }
        return entry.qualityKeys.map(formatQualityLabel).join(" / ");
    }

    return (
        <ScrollView style={style.wrapper}>
            <View style={style.sectionHeader}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    fontColor="textSecondary">
                    {t("cacheManagement.title")}
                </ThemeText>
            </View>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.playbackCache")} />
                <ThemeText style={style.value}>
                    {t("cacheManagement.cacheSummary", {
                        count: stats.playbackCacheCount,
                        size: sizeFormatter(stats.playbackCacheSize),
                    })}
                </ThemeText>
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.pluginCache")} />
                <ThemeText style={style.value}>
                    {t("cacheManagement.pluginCacheCount", {
                        count: stats.pluginCacheCount,
                    })}
                </ThemeText>
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.lyricCache")} />
                <ThemeText style={style.value}>
                    {sizeFormatter(stats.lyricCacheSize)}
                </ThemeText>
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.imageCache")} />
                <ThemeText style={style.value}>
                    {sizeFormatter(stats.imageCacheSize)}
                </ThemeText>
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.totalCache")} />
                <ThemeText style={style.value}>
                    {sizeFormatter(totalCacheSize)}
                </ThemeText>
            </ListItem>
            <ListItem withHorizontalPadding heightType="small">
                <ListItem.Content title={t("cacheManagement.localFileCount")} />
                <ThemeText style={style.value}>
                    {t("cacheManagement.fileCount", {
                        count: stats.localFileCount,
                    })}
                </ThemeText>
            </ListItem>
            <View style={style.sectionHeader}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    fontColor="textSecondary">
                    {t("cacheManagement.cachedEntries")}
                </ThemeText>
            </View>
            <View
                style={[
                    style.searchWrapper,
                    { backgroundColor: colors.placeholder },
                ]}>
                <Input
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t("cacheManagement.searchPlaceholder")}
                    style={style.searchInput}
                />
            </View>
            {platforms.length ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterBar}>
                    <CacheFilterChip
                        title={t("cacheManagement.allPlatforms")}
                        selected={!platformFilter}
                        onPress={() => setPlatformFilter("")}
                    />
                    {platforms.map(platform => (
                        <CacheFilterChip
                            key={platform}
                            title={platform}
                            selected={platformFilter === platform}
                            onPress={() => setPlatformFilter(platform)}
                        />
                    ))}
                </ScrollView>
            ) : null}
            {qualities.length ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterBarCompact}>
                    <CacheFilterChip
                        title={t("cacheManagement.allQualities")}
                        selected={!qualityFilter}
                        onPress={() => setQualityFilter("")}
                    />
                    {qualities.map(quality => (
                        <CacheFilterChip
                            key={quality}
                            title={formatQualityLabel(quality)}
                            selected={qualityFilter === quality}
                            onPress={() => setQualityFilter(quality)}
                        />
                    ))}
                </ScrollView>
            ) : null}
            <View style={style.listSummary}>
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontColor="textSecondary"
                    style={style.listSummaryText}>
                    {t("cacheManagement.listSummary", {
                        shown: filteredCacheEntries.length,
                        total: cacheEntries.length,
                    })}
                </ThemeText>
                <View style={style.listSummaryActions}>
                    {hasActiveListControls && filteredCacheEntries.length ? (
                        <Pressable onPress={showClearFilteredCacheEntriesDialog}>
                            <ThemeText fontSize="description" fontColor="primary">
                                {t("cacheManagement.clearFilteredEntries")}
                            </ThemeText>
                        </Pressable>
                    ) : null}
                    {hasActiveListControls ? (
                        <Pressable onPress={clearListControls}>
                            <ThemeText fontSize="description" fontColor="primary">
                                {t("cacheManagement.clearFilters")}
                            </ThemeText>
                        </Pressable>
                    ) : null}
                </View>
            </View>
            {filteredCacheEntries.length ? (
                filteredCacheEntries.map(entry => (
                    <ListItem
                        key={entry.key}
                        withHorizontalPadding
                        rightPadding={rpx(4)}
                        heightType="small">
                        <ListItem.Content
                            title={entry.title || t("common.unknownName")}
                            description={getCacheEntryDescription(entry)}
                        />
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            style={style.entrySize}>
                            {sizeFormatter(entry.approximateSize)}
                        </ThemeText>
                        <ListItem.ListItemIcon
                            icon="trash-outline"
                            position="right"
                            onPress={() => showClearCacheEntryDialog(entry)}
                        />
                    </ListItem>
                ))
            ) : (
                <View style={style.emptyEntries}>
                    <ThemeText fontSize="description" fontColor="textSecondary">
                        {cacheEntries.length
                            ? t("cacheManagement.noMatchedEntries")
                            : t("cacheManagement.noCachedEntries")}
                    </ThemeText>
                </View>
            )}
            <View style={style.sectionHeader}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    fontColor="textSecondary">
                    {t("cacheManagement.actions")}
                </ThemeText>
            </View>
            <ListItem
                withHorizontalPadding
                heightType="small"
                onPress={showClearPlaybackCacheDialog}>
                <ListItem.Content title={t("cacheManagement.clearPlaybackCache")} />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="small"
                onPress={showClearPluginCacheDialog}>
                <ListItem.Content title={t("cacheManagement.clearPluginCache")} />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="small"
                onPress={showClearAllSafeCachesDialog}>
                <ListItem.Content title={t("cacheManagement.clearAllSafeCaches")} />
            </ListItem>
            <ListItem
                withHorizontalPadding
                heightType="small"
                onPress={() => {
                    void refreshStats();
                }}>
                <ListItem.Content title={t("cacheManagement.refresh")} />
            </ListItem>
            <View style={style.footer} />
        </ScrollView>
    );
}

function CacheFilterChip(props: {
    title: string;
    selected: boolean;
    onPress: () => void;
}) {
    const { title, selected, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[
                style.filterChip,
                {
                    backgroundColor: selected
                        ? Color(colors.primary).alpha(0.18).toString()
                        : colors.placeholder,
                    borderColor: selected
                        ? colors.primary
                        : Color(colors.text).alpha(0.06).toString(),
                },
            ]}
            onPress={onPress}>
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontWeight="semibold"
                color={selected ? colors.primary : colors.text}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

const style = StyleSheet.create({
    wrapper: {
        flex: 1,
    },
    sectionHeader: {
        height: rpx(72),
        paddingHorizontal: rpx(24),
        justifyContent: "center",
        marginTop: rpx(16),
    },
    value: {
        maxWidth: rpx(360),
        textAlign: "right",
    },
    searchWrapper: {
        height: rpx(72),
        marginHorizontal: rpx(24),
        borderRadius: rpx(8),
        justifyContent: "center",
    },
    searchInput: {
        height: "100%",
    },
    filterBar: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    filterBarCompact: {
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
    listSummary: {
        minHeight: rpx(56),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: rpx(16),
    },
    listSummaryText: {
        flex: 1,
    },
    listSummaryActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(18),
    },
    entrySize: {
        marginLeft: rpx(12),
    },
    emptyEntries: {
        height: rpx(96),
        paddingHorizontal: rpx(24),
        justifyContent: "center",
    },
    footer: {
        height: rpx(120),
    },
});
