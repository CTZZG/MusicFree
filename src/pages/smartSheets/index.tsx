import ListItem, { ListItemHeader } from "@/components/base/listItem";
import MusicBar from "@/components/musicBar";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useI18N } from "@/core/i18n";
import {
    SmartSheetType,
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
}

export default function SmartSheets() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const sourcePlatforms = useSmartSheetSourcePlatforms();

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
