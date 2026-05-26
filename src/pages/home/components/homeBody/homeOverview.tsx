import FastImage from "@/components/base/fastImage";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import IconButton from "@/components/base/iconButton";
import ThemeText from "@/components/base/themeText";
import { showPanel } from "@/components/panels/usePanel";
import { ImgAsset } from "@/constants/assetsConst";
import i18n, { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import { musicIsPaused } from "@/utils/trackUtils";
import Color from "color";
import React, { ReactNode, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { DimensionValue } from "react-native";
import type { Plugin } from "@/core/pluginManager";
import useHomeOverview, {
    HomeCapabilityKey,
    IHomeSourceItem,
} from "./useHomeOverview";

function formatTime(value?: number) {
    const seconds = Math.max(0, Math.floor(value ?? 0));
    const minute = Math.floor(seconds / 60);
    const second = seconds % 60;
    return `${minute}:${String(second).padStart(2, "0")}`;
}

function getProgressPercent(
    position?: number,
    duration?: number,
): DimensionValue {
    if (!position || !duration || duration <= 0) {
        return "0%";
    }
    return `${Math.min(
        100,
        Math.max(0, (position / duration) * 100),
    )}%` as DimensionValue;
}

function getMusicDescription(musicItem?: IMusic.IMusicItem | null) {
    if (!musicItem) {
        return "";
    }
    return [musicItem.artist, musicItem.platform].filter(Boolean).join(" · ");
}

function getCapabilityLabel(capability: HomeCapabilityKey) {
    return i18n.t(`home.sourceCapability.${capability}` as any);
}

function formatPluginNames(plugins: Plugin[]) {
    const names = plugins.slice(0, 2).map(plugin => plugin.name);
    const suffix = plugins.length > 2 ? ` +${plugins.length - 2}` : "";
    return `${names.join(" / ")}${suffix}`;
}

export default function HomeOverview() {
    const data = useHomeOverview();

    return (
        <ScrollView
            style={styles.wrapper}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}>
            <SourceChips
                sources={data.sourceChips}
                searchableCount={data.searchablePlugins.length}
            />
            <ContinueListening
                currentMusic={data.currentMusic}
                featuredMusic={data.featuredMusic}
                musicState={data.musicState}
                position={data.progress.position}
                duration={data.progress.duration}
            />
            <RecentListening musics={data.recentMusics} />
            <MusicSources
                sources={data.sources}
                enabledPluginCount={data.enabledPlugins.length}
            />
            <QuickAccess favoriteSheet={data.favoriteSheet} />
            <Discovery
                recommendPlugins={data.recommendPlugins}
                topListPlugins={data.topListPlugins}
                searchablePlugins={data.searchablePlugins}
            />
            <MyMusic
                favoriteSheet={data.favoriteSheet}
                userSheets={data.userSheets}
                starredSheets={data.starredSheets}
                localCount={data.localMusicList.length}
                downloadCount={data.downloadQueue.length}
            />
        </ScrollView>
    );
}

function SourceChips(props: {
    sources: IHomeSourceItem[];
    searchableCount: number;
}) {
    const { sources, searchableCount } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sourceChipContainer}>
            {sources.map(source => {
                const isAll = source.key === "all";
                const label = isAll
                    ? `${t("home.allSources")} ${searchableCount}`
                    : source.name;
                return (
                    <Pressable
                        key={source.key}
                        style={[
                            styles.sourceChip,
                            {
                                backgroundColor: isAll
                                    ? Color(colors.primary)
                                        .alpha(0.16)
                                        .toString()
                                    : colors.card,
                                borderColor: isAll
                                    ? Color(colors.primary)
                                        .alpha(0.5)
                                        .toString()
                                    : Color(colors.text).alpha(0.08).toString(),
                            },
                        ]}
                        onPress={() => {
                            if (source.isLocal) {
                                navigate(ROUTE_PATH.LOCAL);
                            } else {
                                navigate(ROUTE_PATH.SEARCH_PAGE, {
                                    pluginHash: source.pluginHash,
                                });
                            }
                        }}>
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontWeight={isAll ? "semibold" : "medium"}
                            color={isAll ? colors.primary : colors.text}>
                            {label}
                        </ThemeText>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function ContinueListening(props: {
    currentMusic: IMusic.IMusicItem | null;
    featuredMusic: IMusic.IMusicItem | null;
    musicState: ReturnType<typeof useHomeOverview>["musicState"];
    position?: number;
    duration?: number;
}) {
    const { currentMusic, featuredMusic, musicState, position, duration } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const isCurrent =
        !!currentMusic &&
        !!featuredMusic &&
        currentMusic.platform === featuredMusic.platform &&
        currentMusic.id === featuredMusic.id;
    const progressDuration = isCurrent
        ? duration || featuredMusic?.duration
        : featuredMusic?.duration;
    const progressPosition = isCurrent ? position : 0;

    if (!featuredMusic) {
        return (
            <Section title={t("home.continueListening")}>
                <View
                    style={[styles.emptyStart, { backgroundColor: colors.card }]}>
                    <QuickPill
                        icon="magnifying-glass"
                        title={t("home.startSearch")}
                        onPress={() => navigate(ROUTE_PATH.SEARCH_PAGE)}
                    />
                    <QuickPill
                        icon="inbox-arrow-down"
                        title={t("home.importPlaylist.a11y")}
                        onPress={() => showPanel("ImportMusicSheet")}
                    />
                    <QuickPill
                        icon="folder-music-outline"
                        title={t("home.scanLocal")}
                        onPress={() => navigate(ROUTE_PATH.LOCAL)}
                    />
                </View>
            </Section>
        );
    }

    return (
        <Section title={t("home.continueListening")}>
            <Pressable
                style={[
                    styles.continueCard,
                    {
                        backgroundColor: colors.card,
                        borderColor: Color(colors.text).alpha(0.06).toString(),
                    },
                ]}
                onPress={() => {
                    if (isCurrent) {
                        navigate(ROUTE_PATH.MUSIC_DETAIL);
                    } else {
                        TrackPlayer.play(featuredMusic);
                    }
                }}>
                <FastImage
                    source={featuredMusic.artwork}
                    placeholderSource={ImgAsset.albumDefault}
                    style={styles.continueCover}
                />
                <View style={styles.continueContent}>
                    <View style={styles.continueTopLine}>
                        <ThemeText
                            numberOfLines={1}
                            fontSize="title"
                            fontWeight="bold"
                            style={styles.continueTitle}>
                            {featuredMusic.title}
                        </ThemeText>
                        <View
                            style={[
                                styles.platformBadge,
                                {
                                    backgroundColor: Color(colors.primary)
                                        .alpha(0.14)
                                        .toString(),
                                },
                            ]}>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="tag"
                                color={colors.primary}>
                                {featuredMusic.platform}
                            </ThemeText>
                        </View>
                    </View>
                    <ThemeText
                        numberOfLines={1}
                        fontSize="description"
                        fontColor="textSecondary"
                        style={styles.continueDesc}>
                        {featuredMusic.artist || featuredMusic.album}
                    </ThemeText>
                    <View style={styles.progressRow}>
                        <ThemeText fontSize="tag" fontColor="textSecondary">
                            {formatTime(progressPosition)}
                        </ThemeText>
                        <View
                            style={[
                                styles.progressTrack,
                                {
                                    backgroundColor: Color(colors.text)
                                        .alpha(0.1)
                                        .toString(),
                                },
                            ]}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        backgroundColor: colors.primary,
                                        width: getProgressPercent(
                                            progressPosition,
                                            progressDuration,
                                        ),
                                    },
                                ]}
                            />
                        </View>
                        <ThemeText fontSize="tag" fontColor="textSecondary">
                            {formatTime(progressDuration)}
                        </ThemeText>
                    </View>
                </View>
                <Pressable
                    style={[
                        styles.playButton,
                        {
                            backgroundColor: Color(colors.primary)
                                .alpha(0.2)
                                .toString(),
                        },
                    ]}
                    onPress={() => {
                        if (isCurrent && !musicIsPaused(musicState)) {
                            TrackPlayer.pause();
                        } else {
                            TrackPlayer.play(featuredMusic);
                        }
                    }}>
                    <Icon
                        name={
                            isCurrent && !musicIsPaused(musicState)
                                ? "pause"
                                : "play"
                        }
                        size={rpx(36)}
                        color={colors.primary}
                    />
                </Pressable>
            </Pressable>
        </Section>
    );
}

function RecentListening(props: { musics: IMusic.IMusicItem[] }) {
    const { musics } = props;
    const colors = useColors();
    const { t } = useI18N();

    if (!musics.length) {
        return null;
    }

    return (
        <Section title={t("home.recentListening")} compact>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentContainer}>
                {musics.map(musicItem => (
                    <Pressable
                        key={`${musicItem.platform}-${musicItem.id}`}
                        style={[
                            styles.recentItem,
                            { backgroundColor: colors.card },
                        ]}
                        onPress={() => TrackPlayer.play(musicItem)}>
                        <FastImage
                            source={musicItem.artwork}
                            placeholderSource={ImgAsset.albumDefault}
                            style={styles.recentCover}
                        />
                        <View style={styles.recentText}>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="description"
                                fontWeight="semibold">
                                {musicItem.title}
                            </ThemeText>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.smallTextMargin}>
                                {getMusicDescription(musicItem)}
                            </ThemeText>
                        </View>
                    </Pressable>
                ))}
            </ScrollView>
        </Section>
    );
}

function MusicSources(props: {
    sources: IHomeSourceItem[];
    enabledPluginCount: number;
}) {
    const { sources, enabledPluginCount } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    return (
        <Section
            title={t("home.musicSources")}
            subtitle={t("home.enabledSourceCount", {
                count: enabledPluginCount,
            })}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sourceCards}>
                {sources.slice(0, 8).map(source => (
                    <Pressable
                        key={source.key}
                        style={[
                            styles.sourceCard,
                            { backgroundColor: colors.card },
                        ]}
                        onPress={() => {
                            if (source.isLocal) {
                                navigate(ROUTE_PATH.LOCAL);
                            } else {
                                navigate(ROUTE_PATH.SEARCH_PAGE, {
                                    pluginHash: source.pluginHash,
                                });
                            }
                        }}>
                        <View style={styles.sourceCardHeader}>
                            <View
                                style={[
                                    styles.sourceIcon,
                                    {
                                        backgroundColor: Color(colors.primary)
                                            .alpha(0.12)
                                            .toString(),
                                    },
                                ]}>
                                <Icon
                                    name={
                                        source.isLocal
                                            ? "folder-music-outline"
                                            : "javascript"
                                    }
                                    color={colors.primary}
                                    size={rpx(34)}
                                />
                            </View>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="subTitle"
                                fontWeight="bold"
                                style={styles.sourceName}>
                                {source.name}
                            </ThemeText>
                        </View>
                        <View style={styles.capabilityWrap}>
                            {source.capabilities.slice(0, 4).map(capability => (
                                <View
                                    key={capability}
                                    style={[
                                        styles.capabilityTag,
                                        {
                                            backgroundColor: Color(colors.text)
                                                .alpha(0.07)
                                                .toString(),
                                        },
                                    ]}>
                                    <ThemeText
                                        fontSize="tag"
                                        fontColor="textSecondary">
                                        {getCapabilityLabel(capability)}
                                    </ThemeText>
                                </View>
                            ))}
                        </View>
                    </Pressable>
                ))}
                <Pressable
                    style={[
                        styles.sourceCard,
                        styles.manageSourceCard,
                        {
                            borderColor: Color(colors.text)
                                .alpha(0.12)
                                .toString(),
                        },
                    ]}
                    onPress={() =>
                        navigate(ROUTE_PATH.SETTING, {
                            type: "plugin",
                        })
                    }>
                    <Icon
                        name="cog-8-tooth"
                        size={rpx(38)}
                        color={colors.text}
                    />
                    <ThemeText
                        fontSize="subTitle"
                        fontWeight="semibold"
                        style={styles.manageSourceText}>
                        {t("home.manageSources")}
                    </ThemeText>
                </Pressable>
            </ScrollView>
        </Section>
    );
}

function QuickAccess(props: {
    favoriteSheet: IMusic.IMusicSheetItemBase | null;
}) {
    const { favoriteSheet } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const quickItems: {
        key: string;
        icon: IIconName;
        title: string;
        action: () => void;
    }[] = [
        {
            key: "search",
            icon: "magnifying-glass",
            title: t("common.search"),
            action: () => navigate(ROUTE_PATH.SEARCH_PAGE),
        },
        {
            key: "history",
            icon: "clock-outline",
            title: t("home.playHistory"),
            action: () => navigate(ROUTE_PATH.HISTORY),
        },
        {
            key: "local",
            icon: "folder-music-outline",
            title: t("home.localMusic"),
            action: () => navigate(ROUTE_PATH.LOCAL),
        },
        {
            key: "download",
            icon: "arrow-down-tray",
            title: t("common.download"),
            action: () => navigate(ROUTE_PATH.DOWNLOADING),
        },
        {
            key: "topList",
            icon: "trophy",
            title: t("home.topList"),
            action: () => navigate(ROUTE_PATH.TOP_LIST),
        },
        {
            key: "recommend",
            icon: "fire",
            title: t("home.recommendSheet"),
            action: () => navigate(ROUTE_PATH.RECOMMEND_SHEETS),
        },
        {
            key: "sheet",
            icon: "playlist",
            title: t("common.sheet"),
            action: () => {
                if (favoriteSheet) {
                    navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, {
                        id: favoriteSheet.id,
                    });
                }
            },
        },
        {
            key: "playById",
            icon: "identification",
            title: t("home.playById.short"),
            action: () => showPanel("PlayById"),
        },
    ];

    return (
        <Section title={t("home.quickAccess")}>
            <View style={styles.quickGrid}>
                {quickItems.map((item, index) => (
                    <Pressable
                        key={item.key}
                        style={[
                            styles.quickItem,
                            {
                                backgroundColor: colors.card,
                            },
                            index % 4 === 3 ? null : styles.quickItemMarginRight,
                            index < quickItems.length - 4
                                ? styles.quickItemMarginBottom
                                : null,
                        ]}
                        onPress={item.action}>
                        <Icon
                            name={item.icon}
                            color={colors.text}
                            size={rpx(36)}
                        />
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontWeight="semibold"
                            style={styles.quickText}>
                            {item.title}
                        </ThemeText>
                    </Pressable>
                ))}
            </View>
        </Section>
    );
}

function Discovery(props: {
    recommendPlugins: Plugin[];
    topListPlugins: Plugin[];
    searchablePlugins: Plugin[];
}) {
    const { recommendPlugins, topListPlugins, searchablePlugins } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const cards = useMemo(
        () =>
            [
                recommendPlugins.length
                    ? {
                        key: "recommend",
                        icon: "fire" as IIconName,
                        title: t("home.recommendSheet"),
                        desc: formatPluginNames(recommendPlugins),
                        action: () => navigate(ROUTE_PATH.RECOMMEND_SHEETS),
                    }
                    : null,
                topListPlugins.length
                    ? {
                        key: "topList",
                        icon: "trophy" as IIconName,
                        title: t("home.topList"),
                        desc: formatPluginNames(topListPlugins),
                        action: () => navigate(ROUTE_PATH.TOP_LIST),
                    }
                    : null,
                searchablePlugins.length
                    ? {
                        key: "sourceSearch",
                        icon: "magnifying-glass" as IIconName,
                        title: t("home.multiSourceSearch"),
                        desc: t("home.sourceSupportedCount", {
                            count: searchablePlugins.length,
                        }),
                        action: () => navigate(ROUTE_PATH.SEARCH_PAGE),
                    }
                    : null,
            ].filter(Boolean) as {
                key: string;
                icon: IIconName;
                title: string;
                desc: string;
                action: () => void;
            }[],
        [navigate, recommendPlugins, searchablePlugins, t, topListPlugins],
    );

    if (!cards.length) {
        return null;
    }

    return (
        <Section title={t("home.discovery")}>
            <View style={styles.discoveryGrid}>
                {cards.map((card, index) => (
                    <Pressable
                        key={card.key}
                        style={[
                            styles.discoveryCard,
                            {
                                backgroundColor: colors.card,
                            },
                            index % 2 === 0
                                ? styles.discoveryCardMarginRight
                                : null,
                            index < cards.length - 2
                                ? styles.discoveryCardMarginBottom
                                : null,
                        ]}
                        onPress={card.action}>
                        <View
                            style={[
                                styles.discoveryIcon,
                                {
                                    backgroundColor: Color(colors.primary)
                                        .alpha(0.13)
                                        .toString(),
                                },
                            ]}>
                            <Icon
                                name={card.icon}
                                size={rpx(34)}
                                color={colors.primary}
                            />
                        </View>
                        <View style={styles.discoveryText}>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="subTitle"
                                fontWeight="bold">
                                {card.title}
                            </ThemeText>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.smallTextMargin}>
                                {card.desc}
                            </ThemeText>
                        </View>
                    </Pressable>
                ))}
            </View>
        </Section>
    );
}

function MyMusic(props: {
    favoriteSheet: IMusic.IMusicSheetItemBase | null;
    userSheets: IMusic.IMusicSheetItemBase[];
    starredSheets: IMusic.IMusicSheetItem[];
    localCount: number;
    downloadCount: number;
}) {
    const {
        favoriteSheet,
        userSheets,
        starredSheets,
        localCount,
        downloadCount,
    } = props;
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const previewSheets: IMusic.IMusicSheetItemBase[] = [
        ...(favoriteSheet ? [favoriteSheet] : []),
        ...userSheets,
    ].slice(0, 4);
    const previewStarredSheets =
        previewSheets.length < 4
            ? starredSheets.slice(0, 4 - previewSheets.length)
            : [];

    return (
        <Section
            title={t("home.myMusic")}
            right={
                <View style={styles.myMusicActions}>
                    <IconButton
                        name="plus"
                        sizeType="normal"
                        onPress={() => showPanel("CreateMusicSheet")}
                    />
                    <IconButton
                        name="ellipsis-vertical"
                        sizeType="normal"
                        onPress={() => {
                            showPanel("SimpleSelect", {
                                header: i18n.t("home.playlistManagement.a11y"),
                                height: rpx(480),
                                candidates: [
                                    {
                                        title: i18n.t("home.playById.a11y"),
                                        icon: "identification",
                                        value: "playById",
                                    },
                                    {
                                        title: i18n.t(
                                            "home.managePlaylists.a11y",
                                        ),
                                        icon: "pencil-square",
                                        value: "manageSheets",
                                    },
                                    {
                                        title: i18n.t(
                                            "home.importPlaylist.a11y",
                                        ),
                                        icon: "inbox-arrow-down",
                                        value: "importSheets",
                                    },
                                ],
                                onPress(item) {
                                    if (item.value === "playById") {
                                        showPanel("PlayById");
                                    } else if (item.value === "manageSheets") {
                                        navigate(ROUTE_PATH.SHEET_EDITOR, {
                                            sheetType: "local",
                                        });
                                    } else if (item.value === "importSheets") {
                                        showPanel("ImportMusicSheet");
                                    }
                                },
                            });
                        }}
                    />
                </View>
            }>
            <View style={styles.musicStats}>
                <StatCard
                    icon="heart"
                    title={t("home.favoriteSheet")}
                    value={t("home.songCount", {
                        count: favoriteSheet?.worksNum ?? 0,
                    })}
                    onPress={() => {
                        if (favoriteSheet) {
                            navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, {
                                id: favoriteSheet.id,
                            });
                        }
                    }}
                />
                <StatCard
                    icon="folder-music-outline"
                    title={t("home.localMusicShort")}
                    value={t("home.songCount", { count: localCount })}
                    onPress={() => navigate(ROUTE_PATH.LOCAL)}
                />
                <StatCard
                    icon="bookmark-square"
                    title={t("home.starredShort")}
                    value={t("home.playlistCount", {
                        count: starredSheets.length,
                    })}
                    onPress={() =>
                        navigate(ROUTE_PATH.SHEET_EDITOR, {
                            sheetType: "starred",
                        })
                    }
                />
                <StatCard
                    icon="arrow-down-tray"
                    title={t("common.download")}
                    value={t("home.downloadQueueCount", {
                        count: downloadCount,
                    })}
                    onPress={() => navigate(ROUTE_PATH.DOWNLOADING)}
                />
            </View>
            <View
                style={[
                    styles.sheetPreview,
                    {
                        backgroundColor: colors.card,
                    },
                ]}>
                {previewSheets.map(sheet => (
                    <SheetPreviewRow
                        key={`${sheet.platform ?? "local"}-${sheet.id}`}
                        title={sheet.title ?? i18n.t("common.unknownName")}
                        desc={t("home.songCount", { count: sheet.worksNum ?? 0 })}
                        cover={sheet.coverImg ?? sheet.artwork}
                        icon={
                            sheet.id === favoriteSheet?.id
                                ? "heart"
                                : "playlist"
                        }
                        onPress={() =>
                            navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, {
                                id: sheet.id,
                            })
                        }
                    />
                ))}
                {previewStarredSheets.map(sheet => (
                    <SheetPreviewRow
                        key={`${sheet.platform ?? "starred"}-${sheet.id}`}
                        title={sheet.title ?? i18n.t("common.unknownName")}
                        desc={sheet.artist ?? sheet.platform ?? ""}
                        cover={sheet.coverImg ?? sheet.artwork}
                        icon="bookmark-square"
                        onPress={() =>
                            navigate(ROUTE_PATH.PLUGIN_SHEET_DETAIL, {
                                sheetInfo: sheet,
                            })
                        }
                    />
                ))}
            </View>
        </Section>
    );
}

function StatCard(props: {
    icon: IIconName;
    title: string;
    value: string;
    onPress: () => void;
}) {
    const { icon, title, value, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[styles.statCard, { backgroundColor: colors.card }]}
            onPress={onPress}>
            <Icon name={icon} size={rpx(30)} color={colors.text} />
            <ThemeText
                numberOfLines={1}
                fontSize="tag"
                fontWeight="semibold"
                style={styles.statTitle}>
                {title}
            </ThemeText>
            <ThemeText
                numberOfLines={1}
                fontSize="tag"
                fontColor="textSecondary"
                style={styles.statValue}>
                {value}
            </ThemeText>
        </Pressable>
    );
}

function SheetPreviewRow(props: {
    title: string;
    desc: string;
    cover?: string;
    icon: IIconName;
    onPress: () => void;
}) {
    const { title, desc, cover, icon, onPress } = props;
    const colors = useColors();

    return (
        <Pressable style={styles.sheetRow} onPress={onPress}>
            <FastImage
                source={cover}
                placeholderSource={ImgAsset.albumDefault}
                style={styles.sheetCover}
            />
            <View style={styles.sheetRowText}>
                <ThemeText numberOfLines={1} fontWeight="semibold">
                    {title}
                </ThemeText>
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontColor="textSecondary"
                    style={styles.smallTextMargin}>
                    {desc}
                </ThemeText>
            </View>
            <Icon name={icon} size={rpx(30)} color={colors.textSecondary} />
        </Pressable>
    );
}

function QuickPill(props: {
    icon: IIconName;
    title: string;
    onPress: () => void;
}) {
    const { icon, title, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[
                styles.quickPill,
                { backgroundColor: Color(colors.text).alpha(0.07).toString() },
            ]}
            onPress={onPress}>
            <Icon name={icon} size={rpx(30)} color={colors.text} />
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontWeight="semibold"
                style={styles.quickPillText}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

function Section(props: {
    title: string;
    subtitle?: string;
    right?: ReactNode;
    compact?: boolean;
    children: ReactNode;
}) {
    const { title, subtitle, right, compact, children } = props;

    return (
        <View style={[styles.section, compact ? styles.compactSection : null]}>
            <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleBlock}>
                    <ThemeText fontSize="title" fontWeight="bold">
                        {title}
                    </ThemeText>
                    {subtitle ? (
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontColor="textSecondary"
                            style={styles.sectionSubtitle}>
                            {subtitle}
                        </ThemeText>
                    ) : null}
                </View>
                {right}
            </View>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    contentContainer: {
        paddingBottom: rpx(36),
    },
    sourceChipContainer: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(8),
        paddingBottom: rpx(14),
    },
    sourceChip: {
        height: rpx(54),
        minWidth: rpx(96),
        paddingHorizontal: rpx(22),
        borderRadius: rpx(27),
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        marginRight: rpx(12),
    },
    section: {
        marginTop: rpx(20),
    },
    compactSection: {
        marginTop: rpx(14),
    },
    sectionHeader: {
        minHeight: rpx(52),
        paddingHorizontal: rpx(24),
        marginBottom: rpx(14),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    sectionTitleBlock: {
        flex: 1,
        paddingRight: rpx(12),
    },
    sectionSubtitle: {
        marginTop: rpx(8),
    },
    continueCard: {
        marginHorizontal: rpx(24),
        minHeight: rpx(156),
        borderRadius: rpx(18),
        borderWidth: StyleSheet.hairlineWidth,
        padding: rpx(18),
        flexDirection: "row",
        alignItems: "center",
    },
    continueCover: {
        width: rpx(116),
        height: rpx(116),
        borderRadius: rpx(14),
    },
    continueContent: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(18),
    },
    continueTopLine: {
        flexDirection: "row",
        alignItems: "center",
    },
    continueTitle: {
        flex: 1,
        minWidth: 0,
    },
    platformBadge: {
        maxWidth: rpx(132),
        minHeight: rpx(34),
        paddingHorizontal: rpx(12),
        borderRadius: rpx(17),
        alignItems: "center",
        justifyContent: "center",
        marginLeft: rpx(10),
    },
    continueDesc: {
        marginTop: rpx(12),
    },
    progressRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(20),
    },
    progressTrack: {
        flex: 1,
        height: rpx(6),
        borderRadius: rpx(3),
        marginHorizontal: rpx(12),
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: rpx(3),
    },
    playButton: {
        width: rpx(70),
        height: rpx(70),
        borderRadius: rpx(35),
        marginLeft: rpx(14),
        alignItems: "center",
        justifyContent: "center",
    },
    emptyStart: {
        marginHorizontal: rpx(24),
        minHeight: rpx(108),
        borderRadius: rpx(18),
        padding: rpx(14),
        flexDirection: "row",
        alignItems: "center",
    },
    quickPill: {
        flex: 1,
        minWidth: 0,
        height: rpx(76),
        borderRadius: rpx(16),
        marginHorizontal: rpx(4),
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        paddingHorizontal: rpx(10),
    },
    quickPillText: {
        marginLeft: rpx(8),
        flexShrink: 1,
    },
    recentContainer: {
        paddingHorizontal: rpx(24),
    },
    recentItem: {
        width: rpx(260),
        height: rpx(88),
        borderRadius: rpx(16),
        flexDirection: "row",
        alignItems: "center",
        padding: rpx(12),
        marginRight: rpx(14),
    },
    recentCover: {
        width: rpx(64),
        height: rpx(64),
        borderRadius: rpx(12),
    },
    recentText: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(12),
    },
    smallTextMargin: {
        marginTop: rpx(8),
    },
    sourceCards: {
        paddingHorizontal: rpx(24),
    },
    sourceCard: {
        width: rpx(246),
        minHeight: rpx(142),
        borderRadius: rpx(18),
        padding: rpx(16),
        marginRight: rpx(14),
    },
    sourceCardHeader: {
        flexDirection: "row",
        alignItems: "center",
    },
    sourceIcon: {
        width: rpx(52),
        height: rpx(52),
        borderRadius: rpx(14),
        alignItems: "center",
        justifyContent: "center",
    },
    sourceName: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(12),
    },
    capabilityWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: rpx(16),
    },
    capabilityTag: {
        height: rpx(34),
        borderRadius: rpx(17),
        paddingHorizontal: rpx(10),
        alignItems: "center",
        justifyContent: "center",
        marginRight: rpx(8),
        marginBottom: rpx(8),
    },
    manageSourceCard: {
        borderWidth: StyleSheet.hairlineWidth,
        backgroundColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    manageSourceText: {
        marginTop: rpx(12),
    },
    quickGrid: {
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        flexWrap: "wrap",
    },
    quickItem: {
        width: rpx(165),
        height: rpx(96),
        borderRadius: rpx(16),
        alignItems: "center",
        justifyContent: "center",
    },
    quickItemMarginRight: {
        marginRight: rpx(14),
    },
    quickItemMarginBottom: {
        marginBottom: rpx(14),
    },
    quickText: {
        marginTop: rpx(10),
        maxWidth: rpx(132),
    },
    discoveryGrid: {
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        flexWrap: "wrap",
    },
    discoveryCard: {
        width: rpx(343),
        minHeight: rpx(116),
        borderRadius: rpx(18),
        padding: rpx(16),
        flexDirection: "row",
        alignItems: "center",
    },
    discoveryCardMarginRight: {
        marginRight: rpx(16),
    },
    discoveryCardMarginBottom: {
        marginBottom: rpx(16),
    },
    discoveryIcon: {
        width: rpx(58),
        height: rpx(58),
        borderRadius: rpx(16),
        alignItems: "center",
        justifyContent: "center",
    },
    discoveryText: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(14),
    },
    myMusicActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    musicStats: {
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        marginBottom: rpx(14),
    },
    statCard: {
        width: rpx(156),
        minHeight: rpx(104),
        borderRadius: rpx(16),
        marginRight: rpx(12),
        padding: rpx(14),
        justifyContent: "center",
    },
    statTitle: {
        marginTop: rpx(10),
    },
    statValue: {
        marginTop: rpx(8),
    },
    sheetPreview: {
        marginHorizontal: rpx(24),
        borderRadius: rpx(18),
        overflow: "hidden",
    },
    sheetRow: {
        minHeight: rpx(104),
        paddingHorizontal: rpx(14),
        flexDirection: "row",
        alignItems: "center",
    },
    sheetCover: {
        width: rpx(72),
        height: rpx(72),
        borderRadius: rpx(14),
    },
    sheetRowText: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(14),
        marginRight: rpx(10),
    },
});
