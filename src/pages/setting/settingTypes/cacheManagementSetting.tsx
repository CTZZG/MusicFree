import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import LocalMusicSheet from "@/core/localMusicSheet";
import MediaCache from "@/core/mediaCache";
import PluginManager from "@/core/pluginManager";
import { useI18N } from "@/core/i18n";
import { clearCache, getCacheSize, sizeFormatter } from "@/utils/fileUtils";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

interface ICacheStats {
    playbackCacheCount: number;
    playbackCacheSize: number;
    pluginCacheCount: number;
    localFileCount: number;
}

const initialStats: ICacheStats = {
    playbackCacheCount: 0,
    playbackCacheSize: 0,
    pluginCacheCount: 0,
    localFileCount: 0,
};

export default function CacheManagementSetting() {
    const { t } = useI18N();
    const [stats, setStats] = useState<ICacheStats>(initialStats);

    const refreshStats = useCallback(async () => {
        const [mediaStats, musicCacheSize] = await Promise.all([
            Promise.resolve(MediaCache.getMediaCacheStats()),
            getCacheSize("music"),
        ]);
        setStats({
            playbackCacheCount: mediaStats.count,
            playbackCacheSize: musicCacheSize + mediaStats.approximateSize,
            pluginCacheCount: PluginManager.getPluginCacheCount(),
            localFileCount: LocalMusicSheet.getMusicList().length,
        });
    }, []);

    useEffect(() => {
        void refreshStats();
    }, [refreshStats]);

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
                onPress={() => {
                    void refreshStats();
                }}>
                <ListItem.Content title={t("cacheManagement.refresh")} />
            </ListItem>
            <View style={style.footer} />
        </ScrollView>
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
    footer: {
        height: rpx(120),
    },
});
