import ListItem, { ListItemHeader } from "@/components/base/listItem";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useI18N } from "@/core/i18n";
import {
    SmartSheetType,
    useSmartSheetFacets,
    useSmartSheetMusicList,
    useSmartSheetSourceFacets,
} from "@/core/smartMusicSheet";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import StatusBar from "@/components/base/statusBar";
import AppBar from "@/components/base/appBar";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import rpx from "@/utils/rpx";

interface ISmartSheetTemplate {
    key: string;
    type: SmartSheetType;
    title: string;
    icon: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
    platform?: string;
    value?: string;
}

export default function SmartSheets() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const sourceFacets = useSmartSheetSourceFacets();
    const artistFacets = useSmartSheetFacets("artist");
    const albumFacets = useSmartSheetFacets("album");
    const recentPlayedCount = useSmartSheetMusicList("recent-played").length;
    const recentAddedCount = useSmartSheetMusicList("recent-added").length;
    const mostPlayedCount = useSmartSheetMusicList("most-played").length;
    const favoriteCount = useSmartSheetMusicList("favorite").length;
    const localCount = useSmartSheetMusicList("local").length;
    const downloadedCount = useSmartSheetMusicList("downloaded").length;
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));

    const templates: Array<ISmartSheetTemplate & { count: number }> = [
        {
            key: "recent-played",
            type: "recent-played",
            title: t("smartSheet.recentPlayed"),
            icon: "clock-outline",
            count: recentPlayedCount,
        },
        {
            key: "recent-added",
            type: "recent-added",
            title: t("smartSheet.recentAdded"),
            icon: "plus",
            count: recentAddedCount,
        },
        {
            key: "most-played",
            type: "most-played",
            title: t("smartSheet.mostPlayed"),
            icon: "fire",
            count: mostPlayedCount,
        },
        {
            key: "favorite",
            type: "favorite",
            title: t("smartSheet.favorite"),
            icon: "heart",
            count: favoriteCount,
        },
        {
            key: "local",
            type: "local",
            title: t("smartSheet.localMusic"),
            icon: "folder-music-outline",
            count: localCount,
        },
        {
            key: "downloaded",
            type: "downloaded",
            title: t("smartSheet.downloaded"),
            icon: "arrow-down-tray",
            count: downloadedCount,
        },
    ];

    function openSmartSheet(item: ISmartSheetTemplate) {
        navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
            type: item.type,
            platform: item.platform,
            value: item.value,
        });
    }

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("smartSheet.title")}</AppBar>
            <ScrollView
                style={style.wrapper}
                contentContainerStyle={{
                    paddingBottom: musicBarBottomInset || rpx(24),
                }}>
                <ListItemHeader>{t("smartSheet.builtInTemplates")}</ListItemHeader>
                {templates.map(item => (
                    <ListItem
                        key={item.key}
                        withHorizontalPadding
                        onPress={() => openSmartSheet(item)}>
                        <ListItem.ListItemIcon icon={item.icon} />
                        <ListItem.Content
                            title={item.title}
                            description={t("home.songCount", {
                                count: item.count,
                            })}
                        />
                    </ListItem>
                ))}
                {artistFacets.length ? (
                    <>
                        <ListItemHeader>{t("smartSheet.artists")}</ListItemHeader>
                        {artistFacets.map(item => (
                            <ListItem
                                key={item.value}
                                withHorizontalPadding
                                onPress={() =>
                                    openSmartSheet({
                                        key: `artist-${item.value}`,
                                        type: "artist",
                                        value: item.value,
                                        title: item.title,
                                        icon: "user",
                                    })
                                }>
                                <ListItem.ListItemIcon icon="user" />
                                <ListItem.Content
                                    title={item.title}
                                    description={t("home.songCount", {
                                        count: item.count,
                                    })}
                                />
                            </ListItem>
                        ))}
                    </>
                ) : null}
                {albumFacets.length ? (
                    <>
                        <ListItemHeader>{t("smartSheet.albums")}</ListItemHeader>
                        {albumFacets.map(item => (
                            <ListItem
                                key={item.value}
                                withHorizontalPadding
                                onPress={() =>
                                    openSmartSheet({
                                        key: `album-${item.value}`,
                                        type: "album",
                                        value: item.value,
                                        title: item.title,
                                        icon: "album-outline",
                                    })
                                }>
                                <ListItem.ListItemIcon icon="album-outline" />
                                <ListItem.Content
                                    title={item.title}
                                    description={t("home.songCount", {
                                        count: item.count,
                                    })}
                                />
                            </ListItem>
                        ))}
                    </>
                ) : null}
                {sourceFacets.length ? (
                    <>
                        <ListItemHeader>{t("smartSheet.pluginSources")}</ListItemHeader>
                        {sourceFacets.map(item => (
                            <ListItem
                                key={item.value}
                                withHorizontalPadding
                                onPress={() =>
                                    openSmartSheet({
                                        key: `plugin-source-${item.value}`,
                                        type: "plugin-source",
                                        platform: item.value,
                                        title: item.title,
                                        icon: "javascript",
                                    })
                                }>
                                <ListItem.ListItemIcon icon="javascript" />
                                <ListItem.Content
                                    title={t("smartSheet.pluginSourceTitle", {
                                        platform: item.title,
                                    })}
                                    description={t("home.songCount", {
                                        count: item.count,
                                    })}
                                />
                            </ListItem>
                        ))}
                    </>
                ) : null}
            </ScrollView>
        </VerticalSafeAreaView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
