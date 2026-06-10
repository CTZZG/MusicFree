import ListItem, { ListItemHeader } from "@/components/base/listItem";
import MusicBar from "@/components/musicBar";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useI18N } from "@/core/i18n";
import {
    SmartSheetType,
    useSmartSheetFacets,
    useSmartSheetSourcePlatforms,
} from "@/core/smartMusicSheet";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import StatusBar from "@/components/base/statusBar";
import AppBar from "@/components/base/appBar";

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
    const sourcePlatforms = useSmartSheetSourcePlatforms();
    const artistFacets = useSmartSheetFacets("artist");
    const albumFacets = useSmartSheetFacets("album");

    const templates: ISmartSheetTemplate[] = [
        {
            key: "recent-played",
            type: "recent-played",
            title: t("smartSheet.recentPlayed"),
            icon: "clock-outline",
        },
        {
            key: "recent-added",
            type: "recent-added",
            title: t("smartSheet.recentAdded"),
            icon: "plus",
        },
        {
            key: "favorite",
            type: "favorite",
            title: t("smartSheet.favorite"),
            icon: "heart",
        },
        {
            key: "local",
            type: "local",
            title: t("smartSheet.localMusic"),
            icon: "folder-music-outline",
        },
        {
            key: "downloaded",
            type: "downloaded",
            title: t("smartSheet.downloaded"),
            icon: "arrow-down-tray",
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
            <ScrollView style={style.wrapper}>
                <ListItemHeader>{t("smartSheet.builtInTemplates")}</ListItemHeader>
                {templates.map(item => (
                    <ListItem
                        key={item.key}
                        withHorizontalPadding
                        onPress={() => openSmartSheet(item)}>
                        <ListItem.ListItemIcon icon={item.icon} />
                        <ListItem.Content title={item.title} />
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
                {sourcePlatforms.length ? (
                    <>
                        <ListItemHeader>{t("smartSheet.pluginSources")}</ListItemHeader>
                        {sourcePlatforms.map(platform => (
                            <ListItem
                                key={platform}
                                withHorizontalPadding
                                onPress={() =>
                                    openSmartSheet({
                                        key: `plugin-source-${platform}`,
                                        type: "plugin-source",
                                        platform,
                                        title: platform,
                                        icon: "javascript",
                                    })
                                }>
                                <ListItem.ListItemIcon icon="javascript" />
                                <ListItem.Content
                                    title={t("smartSheet.pluginSourceTitle", {
                                        platform,
                                    })}
                                />
                            </ListItem>
                        ))}
                    </>
                ) : null}
            </ScrollView>
            <MusicBar />
        </VerticalSafeAreaView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
