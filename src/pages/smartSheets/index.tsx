import ListItem from "@/components/base/listItem";
import AppBar from "@/components/base/appBar";
import {
    ShortcutPageSurface,
    ShortcutSectionTitle,
    ShortcutStatusBar,
    useShortcutCardStyle,
} from "@/components/base/shortcutPageSurface";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useI18N } from "@/core/i18n";
import {
    SmartSheetType,
    useSmartSheetLibrarySnapshot,
} from "@/core/smartMusicSheet";
import React, { useMemo } from "react";
import { SectionList, StyleSheet } from "react-native";
import rpx from "@/utils/rpx";
import TextButton from "@/components/base/textButton";
import { useState } from "react";

interface ISmartSheetListItem {
    key: string;
    type: SmartSheetType;
    title: string;
    icon: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
    count: number;
    platform?: string;
    value?: string;
    description?: string;
}

export default function SmartSheets() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const snapshot = useSmartSheetLibrarySnapshot();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));
    const cardStyle = useShortcutCardStyle({ compact: true });
    const [expandedFacets, setExpandedFacets] = useState({
        artist: false,
        album: false,
        source: false,
    });

    const sections = useMemo(() => {
        const builtInItems: ISmartSheetListItem[] = [
            {
                key: "recent-played",
                type: "recent-played",
                title: t("smartSheet.recentPlayed"),
                icon: "clock-outline",
                count: snapshot.recentPlayed.length,
            },
            {
                key: "recent-added",
                type: "recent-added",
                title: t("smartSheet.recentAdded"),
                icon: "plus",
                count: snapshot.recentAdded.length,
            },
            {
                key: "most-played",
                type: "most-played",
                title: t("smartSheet.mostPlayed"),
                icon: "fire",
                count: snapshot.mostPlayed.length,
            },
            {
                key: "favorite",
                type: "favorite",
                title: t("smartSheet.favorite"),
                icon: "heart",
                count: snapshot.favorite.length,
            },
            {
                key: "local",
                type: "local",
                title: t("smartSheet.localMusic"),
                icon: "folder-music-outline",
                count: snapshot.local.length,
            },
            {
                key: "downloaded",
                type: "downloaded",
                title: t("smartSheet.downloaded"),
                icon: "arrow-down-tray",
                count: snapshot.downloaded.length,
            },
        ];
        const artistItems = snapshot.artistFacets
            .slice(0, expandedFacets.artist ? undefined : 10)
            .map(item => ({
                key: `artist-${item.value}`,
                type: "artist" as const,
                value: item.value,
                title: item.title,
                icon: "user" as const,
                count: item.count,
            }));
        const albumItems = snapshot.albumFacets
            .slice(0, expandedFacets.album ? undefined : 10)
            .map(item => ({
                key: `album-${item.value}`,
                type: "album" as const,
                value: item.value,
                title: item.title,
                icon: "album-outline" as const,
                count: item.count,
            }));
        const sourceItems = snapshot.sourceFacets
            .slice(0, expandedFacets.source ? undefined : 8)
            .map(item => ({
                key: `plugin-source-${item.value}`,
                type: "plugin-source" as const,
                platform: item.value,
                title: t("smartSheet.pluginSourceTitle", {
                    platform: item.title,
                }),
                icon: "javascript" as const,
                count: item.count,
            }));

        return [
            {
                title: t("smartSheet.forYou"),
                data: [{
                    key: "recommended",
                    type: "recommended" as const,
                    title: t("smartSheet.recommended"),
                    description: t("smartSheet.recommendedHint", {
                        count: snapshot.recommended.length,
                    }),
                    icon: "strategy" as const,
                    count: snapshot.recommended.length,
                }],
            },
            {
                title: t("smartSheet.builtInTemplates"),
                data: builtInItems,
            },
            ...(artistItems.length ? [{
                title: t("smartSheet.artists"),
                data: artistItems,
                facet: "artist" as const,
                total: snapshot.artistFacets.length,
            }] : []),
            ...(albumItems.length ? [{
                title: t("smartSheet.albums"),
                data: albumItems,
                facet: "album" as const,
                total: snapshot.albumFacets.length,
            }] : []),
            ...(sourceItems.length ? [{
                title: t("smartSheet.pluginSources"),
                data: sourceItems,
                facet: "source" as const,
                total: snapshot.sourceFacets.length,
            }] : []),
        ];
    }, [expandedFacets, snapshot, t]);

    function openSmartSheet(item: ISmartSheetListItem) {
        navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
            type: item.type,
            platform: item.platform,
            value: item.value,
        });
    }

    return (
        <ShortcutPageSurface>
            <ShortcutStatusBar />
            <AppBar backgroundColor="transparent" spacious>
                {t("smartSheet.title")}
            </AppBar>
            <SectionList
                style={styles.wrapper}
                sections={sections}
                keyExtractor={item => item.key}
                renderSectionHeader={({ section }) => (
                    <ShortcutSectionTitle
                        action={
                            section.facet &&
                            section.data.length < (section.total ?? 0) ? (
                                    <TextButton
                                        onPress={() => {
                                            setExpandedFacets(current => ({
                                                ...current,
                                                [section.facet!]: true,
                                            }));
                                        }}>
                                        {t("smartSheet.limit.all")}
                                    </TextButton>
                                ) : undefined
                        }>
                        {section.title}
                    </ShortcutSectionTitle>
                )}
                renderItem={({ item }) => (
                    <ListItem
                        withHorizontalPadding
                        pressableStyle={cardStyle}
                        onPress={() => openSmartSheet(item)}>
                        <ListItem.ListItemIcon icon={item.icon} />
                        <ListItem.Content
                            title={item.title}
                            description={
                                item.description ?? t("home.songCount", {
                                    count: item.count,
                                })
                            }
                        />
                        <ListItem.ListItemIcon
                            icon="chevron-right"
                            position="right"
                        />
                    </ListItem>
                )}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: musicBarBottomInset || rpx(24) },
                ]}
                initialNumToRender={10}
                maxToRenderPerBatch={8}
                updateCellsBatchingPeriod={40}
                windowSize={7}
                stickySectionHeadersEnabled={false}
                removeClippedSubviews
            />
        </ShortcutPageSurface>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    content: {
        paddingTop: rpx(6),
    },
});
