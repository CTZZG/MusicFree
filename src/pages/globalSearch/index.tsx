import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import Icon from "@/components/base/icon.tsx";
import IconButton from "@/components/base/iconButton";
import Input from "@/components/base/input";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import MusicBar from "@/components/musicBar";
import { showPanel } from "@/components/panels/usePanel";
import { localMusicSheetId } from "@/constants/commonConst";
import { useI18N } from "@/core/i18n";
import LocalMusicSheet from "@/core/localMusicSheet";
import PluginManager, { useSortedPlugins } from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useSheetsBase } from "@/core/musicSheet";
import {
    useSmartSheetFacets,
    useSmartSheetSourceFacets,
} from "@/core/smartMusicSheet";
import type { SmartSheetType } from "@/core/smartMusicSheet";
import TrackPlayer from "@/core/trackPlayer";
import { iconSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import type { ILanguageData } from "@/types/core/i18n";
import Color from "color";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type GlobalSearchResultType =
    | "online-search"
    | "music"
    | "local-music"
    | "local-music-item"
    | "local-music-command"
    | "music-sheet"
    | "plugin"
    | "plugin-command"
    | "page"
    | "setting";

interface IGlobalSearchResult {
    id: string;
    type: GlobalSearchResultType;
    title: string;
    description: string;
    icon: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
    trailingIcon?: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
    keywords?: string[];
    musicItem?: IMusic.IMusicItem;
    onPress: () => void | Promise<void>;
}

interface ISmartSheetTemplateSearchTarget {
    id: string;
    type: SmartSheetType;
    title: string;
    icon: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
    keywords: string[];
}

const maxDirectLocalMusicResults = 5;
const maxLocalFacetResults = 5;

const onlineSearchTargets: Array<{
    searchType: ICommon.SupportMediaType;
    labelKey: keyof ILanguageData;
    icon: Parameters<typeof ListItem.ListItemIcon>[0]["icon"];
}> = [
    {
        searchType: "music",
        labelKey: "common.singleMusic",
        icon: "magnifying-glass",
    },
    {
        searchType: "sheet",
        labelKey: "common.sheet",
        icon: "playlist",
    },
    {
        searchType: "album",
        labelKey: "common.album",
        icon: "album-outline",
    },
    {
        searchType: "artist",
        labelKey: "common.artist",
        icon: "user",
    },
];

function normalizeKeyword(text?: string) {
    return (text ?? "").trim().toLowerCase();
}

function matchesQuery(query: string, item: IGlobalSearchResult) {
    const normalizedQuery = normalizeKeyword(query);
    if (!normalizedQuery) {
        return false;
    }
    return [item.title, item.description, ...(item.keywords ?? [])]
        .map(normalizeKeyword)
        .some(text => text.includes(normalizedQuery));
}

function matchesMusicQuery(query: string, musicItem: IMusic.IMusicItem) {
    const normalizedQuery = normalizeKeyword(query);
    if (!normalizedQuery) {
        return false;
    }
    return [
        musicItem.title,
        musicItem.artist,
        musicItem.album,
        musicItem.platform,
    ].map(normalizeKeyword).some(text => text.includes(normalizedQuery));
}

function matchesTextQuery(query: string, ...values: Array<string | undefined>) {
    const normalizedQuery = normalizeKeyword(query);
    if (!normalizedQuery) {
        return false;
    }
    return values.map(normalizeKeyword).some(text =>
        text.includes(normalizedQuery),
    );
}

function formatLocalMusicDescription(musicItem: IMusic.IMusicItem) {
    return [
        musicItem.artist,
        musicItem.album,
        musicItem.platform,
    ].filter(Boolean).join(" · ");
}

export default function GlobalSearch() {
    const { t } = useI18N();
    const navigate = useNavigate();
    const colors = useColors();
    const plugins = useSortedPlugins();
    const sheets = useSheetsBase();
    const artistFacets = useSmartSheetFacets("artist");
    const albumFacets = useSmartSheetFacets("album");
    const sourceFacets = useSmartSheetSourceFacets();
    const localMusicList = LocalMusicSheet.useMusicList();
    const [query, setQuery] = useState("");
    const [commandRevision, setCommandRevision] = useState(0);
    const normalizedQuery = query.trim();

    const pageTargets = useMemo<IGlobalSearchResult[]>(() => [
        {
            id: "page-local-music",
            type: "page",
            title: t("home.localMusic"),
            description: t("globalSearch.pageDescription"),
            icon: "folder-music-outline",
            keywords: [
                t("localMusic.scanLocalMusic"),
                t("localMusic.beginScan"),
                t("smartSheet.localMusic"),
            ],
            onPress: () => navigate(ROUTE_PATH.LOCAL),
        },
        {
            id: "page-downloading",
            type: "page",
            title: t("downloading.title"),
            description: t("globalSearch.pageDescription"),
            icon: "arrow-down-tray",
            keywords: [
                t("localMusic.downloadList"),
                t("downloading.filter.active"),
                t("downloading.filter.completed"),
                t("downloading.filter.error"),
            ],
            onPress: () => navigate(ROUTE_PATH.DOWNLOADING),
        },
        {
            id: "page-history",
            type: "page",
            title: t("history.title"),
            description: t("globalSearch.pageDescription"),
            icon: "clock-outline",
            keywords: [
                t("smartSheet.recentPlayed"),
                t("history.clearHistory"),
                t("searchPage.history"),
            ],
            onPress: () => navigate(ROUTE_PATH.HISTORY),
        },
        {
            id: "page-smart-sheets",
            type: "page",
            title: t("smartSheet.title"),
            description: t("globalSearch.pageDescription"),
            icon: "strategy",
            keywords: [
                t("home.smartSheets"),
                t("smartSheet.recentAdded"),
                t("smartSheet.mostPlayed"),
                t("smartSheet.favorite"),
                t("smartSheet.downloaded"),
                t("smartSheet.artists"),
                t("smartSheet.albums"),
            ],
            onPress: () => navigate(ROUTE_PATH.SMART_SHEETS),
        },
    ], [navigate, t]);

    const settingTargets = useMemo<IGlobalSearchResult[]>(() => [
        {
            id: "setting-basic",
            type: "setting",
            title: t("sidebar.basicSettings"),
            description: t("globalSearch.settingDescription"),
            icon: "cog-8-tooth",
            keywords: [
                t("basicSettings.lyric"),
                t("basicSettings.clickMusicInSearch"),
                t("basicSettings.qualityManagement"),
                t("basicSettings.download"),
            ],
            onPress: () => navigate(ROUTE_PATH.SETTING, { type: "basic" }),
        },
        {
            id: "setting-plugin",
            type: "setting",
            title: t("sidebar.pluginManagement"),
            description: t("globalSearch.settingDescription"),
            icon: "javascript",
            keywords: [
                t("pluginSetting.menu.installPlugin"),
                t("pluginSetting.menu.subscriptionSetting"),
                t("pluginSetting.menu.sort"),
            ],
            onPress: () => navigate(ROUTE_PATH.SETTING, { type: "plugin" }),
        },
        {
            id: "setting-plugin-subscribe",
            type: "setting",
            title: t("pluginSetting.menu.subscriptionSetting"),
            description: t("globalSearch.settingDescription"),
            icon: "bookmark-square",
            keywords: [
                t("sidebar.pluginManagement"),
                t("pluginSetting.menu.installPlugin"),
            ],
            onPress: () =>
                navigate(ROUTE_PATH.SETTING, {
                    type: "plugin",
                    initialPluginSettingRoute: "/pluginsetting/subscribe",
                }),
        },
        {
            id: "setting-plugin-sort",
            type: "setting",
            title: t("pluginSetting.menu.sort"),
            description: t("globalSearch.settingDescription"),
            icon: "bars-3",
            keywords: [
                t("sidebar.pluginManagement"),
                t("pluginSetting.menu.sort"),
            ],
            onPress: () =>
                navigate(ROUTE_PATH.SETTING, {
                    type: "plugin",
                    initialPluginSettingRoute: "/pluginsetting/sort",
                }),
        },
        {
            id: "setting-plugin-capability-matrix",
            type: "setting",
            title: t("pluginSetting.menu.capabilityMatrix"),
            description: t("globalSearch.settingDescription"),
            icon: "check-circle",
            keywords: [
                t("sidebar.pluginManagement"),
                t("pluginSetting.filter.capability.all"),
            ],
            onPress: () =>
                navigate(ROUTE_PATH.SETTING, {
                    type: "plugin",
                    initialPluginSettingRoute:
                        "/pluginsetting/capability-matrix",
                }),
        },
        {
            id: "setting-theme",
            type: "setting",
            title: t("sidebar.themeSettings"),
            description: t("globalSearch.settingDescription"),
            icon: "t-shirt-outline",
            keywords: [
                t("themeSettings.setTheme"),
                t("themeSettings.customMode"),
                t("themeSettings.coverStyle"),
            ],
            onPress: () => navigate(ROUTE_PATH.SETTING, { type: "theme" }),
        },
        {
            id: "setting-backup",
            type: "setting",
            title: t("sidebar.backupAndResume"),
            description: t("globalSearch.settingDescription"),
            icon: "circle-stack",
            keywords: [
                t("backupAndResume.backupToLocal"),
                t("backupAndResume.resumeFromLocalFile"),
                t("backupAndResume.webdavSettings"),
            ],
            onPress: () => navigate(ROUTE_PATH.SETTING, { type: "backup" }),
        },
        {
            id: "setting-about",
            type: "setting",
            title: t("common.about"),
            description: t("globalSearch.settingDescription"),
            icon: "information-circle",
            keywords: ["version", "update", "版本", "更新"],
            onPress: () => navigate(ROUTE_PATH.SETTING, { type: "about" }),
        },
    ], [navigate, t]);

    const smartSheetTemplateTargets = useMemo<IGlobalSearchResult[]>(() => {
        const templates: ISmartSheetTemplateSearchTarget[] = [
            {
                id: "smart-sheet-recent-played",
                type: "recent-played",
                title: t("smartSheet.recentPlayed"),
                icon: "clock-outline",
                keywords: [
                    t("history.title"),
                    t("searchPage.history"),
                ],
            },
            {
                id: "smart-sheet-recent-added",
                type: "recent-added",
                title: t("smartSheet.recentAdded"),
                icon: "plus",
                keywords: [
                    t("smartSheet.recentAdded"),
                    t("musicListEditor.addToSheet"),
                ],
            },
            {
                id: "smart-sheet-most-played",
                type: "most-played",
                title: t("smartSheet.mostPlayed"),
                icon: "fire",
                keywords: [
                    t("smartSheet.mostPlayed"),
                    t("smartSheet.title"),
                ],
            },
            {
                id: "smart-sheet-favorite",
                type: "favorite",
                title: t("smartSheet.favorite"),
                icon: "heart",
                keywords: [
                    t("smartSheet.favorite"),
                    t("smartSheet.title"),
                ],
            },
            {
                id: "smart-sheet-local",
                type: "local",
                title: t("smartSheet.localMusic"),
                icon: "folder-music-outline",
                keywords: [
                    t("home.localMusic"),
                    t("localMusic.scanLocalMusic"),
                ],
            },
            {
                id: "smart-sheet-downloaded",
                type: "downloaded",
                title: t("smartSheet.downloaded"),
                icon: "arrow-down-tray",
                keywords: [
                    t("localMusic.downloadList"),
                    t("downloading.filter.completed"),
                ],
            },
        ];

        return templates.map(template => ({
            id: template.id,
            type: "page",
            title: template.title,
            description: t("globalSearch.smartSheetDescription"),
            icon: template.icon,
            keywords: [
                t("smartSheet.title"),
                t("home.smartSheets"),
                ...template.keywords,
            ],
            onPress: () =>
                navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
                    type: template.type,
                }),
        }));
    }, [navigate, t]);

    const localResults = useMemo(() => {
        if (!normalizedQuery) {
            return [];
        }
        const matchedLocalMusic = (localMusicList ?? []).filter(item =>
            matchesMusicQuery(normalizedQuery, item),
        );
        const directLocalMusicResults: IGlobalSearchResult[] = matchedLocalMusic
            .slice(0, maxDirectLocalMusicResults)
            .flatMap((musicItem, index) => {
                const itemKey = `${getMediaUniqueKey(musicItem)}-${index}`;
                const keywords = [
                    musicItem.artist,
                    musicItem.album,
                    musicItem.platform,
                ];
                return [
                    {
                        id: `local-music-item-${itemKey}`,
                        type: "local-music-item",
                        title: musicItem.title,
                        description: formatLocalMusicDescription(musicItem),
                        icon: "musical-note",
                        musicItem,
                        keywords,
                        onPress: () =>
                            TrackPlayer.playWithReplacePlayList(
                                musicItem,
                                matchedLocalMusic,
                            ),
                    },
                    {
                        id: `local-music-command-next-${itemKey}`,
                        type: "local-music-command",
                        title: t("globalSearch.localMusicPlayNextTitle", {
                            title: musicItem.title,
                        }),
                        description: formatLocalMusicDescription(musicItem) ||
                            t("globalSearch.localMusicPlayNextDescription"),
                        icon: "plus",
                        trailingIcon: "playlist",
                        musicItem,
                        keywords: [
                            ...keywords,
                            t("musicListEditor.addToNextPlay"),
                        ],
                        onPress: () => {
                            TrackPlayer.addNext(musicItem);
                            Toast.success(t("toast.addToNextPlay"));
                        },
                    },
                    {
                        id: `local-music-command-sheet-${itemKey}`,
                        type: "local-music-command",
                        title: t("globalSearch.localMusicAddToSheetTitle", {
                            title: musicItem.title,
                        }),
                        description: formatLocalMusicDescription(musicItem) ||
                            t("globalSearch.localMusicAddToSheetDescription"),
                        icon: "playlist",
                        trailingIcon: "plus",
                        musicItem,
                        keywords: [
                            ...keywords,
                            t("musicListEditor.addToSheet"),
                            t("panel.addToMusicSheet.newMusicSheet"),
                        ],
                        onPress: () => {
                            showPanel("AddToMusicSheet", {
                                musicItem,
                            });
                        },
                    },
                ];
            });
        const localMusicResults: IGlobalSearchResult[] =
            matchedLocalMusic.length
                ? [
                    ...directLocalMusicResults,
                    {
                        id: "local-music-results",
                        type: "local-music",
                        title: t("globalSearch.localMusicTitle", {
                            query: normalizedQuery,
                        }),
                        description: t("globalSearch.localMusicDescription", {
                            count: matchedLocalMusic.length,
                        }),
                        icon: "musical-note",
                        onPress: () =>
                            navigate(ROUTE_PATH.SEARCH_MUSIC_LIST, {
                                musicList: matchedLocalMusic,
                                musicSheet: {
                                    id: localMusicSheetId,
                                    title: t("home.localMusic"),
                                    musicList: matchedLocalMusic,
                                    worksNum: matchedLocalMusic.length,
                                } as IMusic.IMusicSheetItem,
                            }),
                    },
                ]
                : [];
        const localArtistResults: IGlobalSearchResult[] = artistFacets
            .filter(facet =>
                matchesTextQuery(
                    normalizedQuery,
                    facet.title,
                    facet.value,
                    t("smartSheet.artists"),
                    t("common.artist"),
                ),
            )
            .slice(0, maxLocalFacetResults)
            .map(facet => ({
                id: `local-artist-${facet.value}`,
                type: "local-music",
                title: t("smartSheet.artistTitle", {
                    artist: facet.title,
                }),
                description: t("home.songCount", {
                    count: facet.count,
                }),
                icon: "user",
                keywords: [
                    facet.value,
                    t("smartSheet.artists"),
                    t("common.artist"),
                ],
                onPress: () =>
                    navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
                        type: "artist",
                        value: facet.value,
                    }),
            }));
        const localAlbumResults: IGlobalSearchResult[] = albumFacets
            .filter(facet =>
                matchesTextQuery(
                    normalizedQuery,
                    facet.title,
                    facet.value,
                    t("smartSheet.albums"),
                    t("common.album"),
                ),
            )
            .slice(0, maxLocalFacetResults)
            .map(facet => ({
                id: `local-album-${facet.value}`,
                type: "local-music",
                title: t("smartSheet.albumTitle", {
                    album: facet.title,
                }),
                description: t("home.songCount", {
                    count: facet.count,
                }),
                icon: "album-outline",
                keywords: [
                    facet.value,
                    t("smartSheet.albums"),
                    t("common.album"),
                ],
                onPress: () =>
                    navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
                        type: "album",
                        value: facet.value,
                    }),
            }));
        const localSourceResults: IGlobalSearchResult[] = sourceFacets
            .filter(facet =>
                matchesTextQuery(
                    normalizedQuery,
                    facet.title,
                    facet.value,
                    t("smartSheet.pluginSources"),
                ),
            )
            .slice(0, maxLocalFacetResults)
            .map(facet => ({
                id: `local-source-${facet.value}`,
                type: "local-music",
                title: t("smartSheet.pluginSourceTitle", {
                    platform: facet.title,
                }),
                description: t("home.songCount", {
                    count: facet.count,
                }),
                icon: "javascript",
                keywords: [
                    facet.value,
                    t("smartSheet.pluginSources"),
                ],
                onPress: () =>
                    navigate(ROUTE_PATH.SMART_SHEET_DETAIL, {
                        type: "plugin-source",
                        platform: facet.value,
                    }),
            }));
        const pluginResults: IGlobalSearchResult[] = plugins.flatMap(plugin => {
            const pluginEnabled = PluginManager.isPluginEnabled(plugin);
            const pluginKeywords = [
                plugin.instance.author ?? "",
                plugin.instance.description ?? "",
                plugin.instance.platform ?? "",
            ];
            return [
                {
                    id: `plugin-${plugin.hash}`,
                    type: "plugin",
                    title: plugin.name,
                    description: t("globalSearch.pluginDescription"),
                    icon: "javascript",
                    keywords: pluginKeywords,
                    onPress: () =>
                        navigate(ROUTE_PATH.SETTING, {
                            type: "plugin",
                            initialPluginName: plugin.name,
                        }),
                },
                {
                    id: `plugin-command-toggle-${plugin.hash}`,
                    type: "plugin-command",
                    title: pluginEnabled
                        ? t("globalSearch.pluginDisableTitle", {
                            name: plugin.name,
                        })
                        : t("globalSearch.pluginEnableTitle", {
                            name: plugin.name,
                        }),
                    description: pluginEnabled
                        ? t("globalSearch.pluginDisableDescription")
                        : t("globalSearch.pluginEnableDescription"),
                    icon: "power-outline",
                    trailingIcon: pluginEnabled
                        ? "x-mark"
                        : "check-circle",
                    keywords: [
                        ...pluginKeywords,
                        plugin.name,
                        t("pluginSetting.pluginItem.detail.enabled"),
                        t("pluginSetting.pluginItem.detail.disabled"),
                    ],
                    onPress: () => {
                        PluginManager.setPluginEnabled(plugin, !pluginEnabled);
                        setCommandRevision(value => value + 1);
                        Toast.success(
                            pluginEnabled
                                ? t("globalSearch.pluginDisabledToast", {
                                    name: plugin.name,
                                })
                                : t("globalSearch.pluginEnabledToast", {
                                    name: plugin.name,
                                }),
                        );
                    },
                },
            ];
        });
        const sheetResults: IGlobalSearchResult[] = sheets.map(sheet => ({
            id: `sheet-${sheet.id}`,
            type: "music-sheet",
            title: sheet.title ?? t("common.sheet"),
            description: t("globalSearch.sheetDescription", {
                count: sheet.worksNum ?? 0,
            }),
            icon: "playlist",
            keywords: [sheet.description ?? ""],
            onPress: () =>
                navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, {
                    id: sheet.id,
                }),
        }));

        const otherLocalResults = [
            ...pluginResults,
            ...smartSheetTemplateTargets,
            ...pageTargets,
            ...sheetResults,
            ...settingTargets,
        ].filter(
            item => matchesQuery(normalizedQuery, item),
        );
        return [
            ...localMusicResults,
            ...localArtistResults,
            ...localAlbumResults,
            ...localSourceResults,
            ...otherLocalResults,
        ];
    }, [
        albumFacets,
        artistFacets,
        commandRevision,
        localMusicList,
        navigate,
        normalizedQuery,
        pageTargets,
        plugins,
        settingTargets,
        sheets,
        smartSheetTemplateTargets,
        sourceFacets,
        t,
    ]);

    const onlineSearchResults = useMemo<IGlobalSearchResult[]>(() => {
        if (!normalizedQuery) {
            return [];
        }
        return onlineSearchTargets.map(target => {
            const typeLabel = t(target.labelKey);
            return {
                id: `online-search-${target.searchType}`,
                type: "online-search",
                title: t("globalSearch.onlineSearchTitle", {
                    type: typeLabel,
                    query: normalizedQuery,
                }),
                description: t("globalSearch.onlineSearchDescription", {
                    type: typeLabel,
                }),
                icon: target.icon,
                onPress: () =>
                    navigate(ROUTE_PATH.SEARCH_PAGE, {
                        initialQuery: normalizedQuery,
                        initialSearchType: target.searchType,
                    }),
            };
        });
    }, [navigate, normalizedQuery, t]);

    const hintTextColor = Color(colors.text).alpha(0.6).toString();

    return (
        <SafeAreaView edges={["bottom", "top"]} style={styles.wrapper}>
            <AppBar containerStyle={styles.appbar} contentStyle={styles.appbar}>
                <View style={styles.searchBarContainer}>
                    <Icon
                        name="magnifying-glass"
                        color={hintTextColor}
                        size={iconSizeConst.small}
                        style={styles.magnify}
                    />
                    <Input
                        autoFocus
                        style={[
                            styles.searchBar,
                            {
                                color: colors.text,
                                backgroundColor: colors.pageBackground,
                            },
                        ]}
                        accessible
                        accessibilityLabel={t("globalSearch.searchLabel.a11y")}
                        accessibilityHint={t("globalSearch.placeholder")}
                        placeholderTextColor={hintTextColor}
                        placeholder={t("globalSearch.placeholder")}
                        onChangeText={setQuery}
                        value={query}
                    />
                    {query.length ? (
                        <IconButton
                            style={styles.close}
                            sizeType="light"
                            onPress={() => setQuery("")}
                            color={hintTextColor}
                            name="x-mark"
                        />
                    ) : null}
                </View>
            </AppBar>
            <SafeAreaView edges={["left", "right"]} style={styles.wrapper}>
                {!normalizedQuery ? (
                    <Empty content={t("globalSearch.emptyQuery")} />
                ) : (
                    <ScrollView
                        style={styles.resultWrapper}
                        keyboardShouldPersistTaps="handled">
                        {onlineSearchResults.length ? (
                            <>
                                <ListItemHeader>
                                    {t("globalSearch.onlineSection")}
                                </ListItemHeader>
                                {onlineSearchResults.map(item => (
                                    <GlobalSearchListItem
                                        key={item.id}
                                        item={item}
                                    />
                                ))}
                            </>
                        ) : null}
                        {localResults.length ? (
                            <>
                                <ListItemHeader>
                                    {t("globalSearch.localSection")}
                                </ListItemHeader>
                                {localResults.map(item => (
                                    <GlobalSearchListItem
                                        key={item.id}
                                        item={item}
                                    />
                                ))}
                            </>
                        ) : (
                            <Empty content={t("globalSearch.noLocalResult")} />
                        )}
                    </ScrollView>
                )}
            </SafeAreaView>
            <MusicBar />
        </SafeAreaView>
    );
}

function GlobalSearchListItem(props: { item: IGlobalSearchResult }) {
    const { item } = props;
    const { t } = useI18N();
    const localFileExists = LocalMusicSheet.useLocalFileExists(
        item.musicItem ?? null,
    );
    const localMusicFileMissing = !!item.musicItem && localFileExists === false;

    return (
        <ListItem
            withHorizontalPadding
            onPress={() => {
                if (localMusicFileMissing) {
                    Toast.warn(t("localMusic.fileMissingTapHint"));
                    return;
                }
                item.onPress();
            }}>
            <ListItem.ListItemIcon
                icon={localMusicFileMissing ? "exclamation-circle" : item.icon}
            />
            <ListItem.Content
                title={item.title}
                description={
                    localMusicFileMissing
                        ? t("localMusic.fileMissing")
                        : item.description
                }
            />
            <ListItem.ListItemIcon
                icon={
                    item.trailingIcon
                        ? item.trailingIcon
                        : item.type === "local-music-item"
                        ? "play"
                        : "chevron-right"
                }
                position="right"
                fixedWidth
            />
        </ListItem>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    appbar: {
        paddingRight: 0,
    },
    searchBarContainer: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
    },
    searchBar: {
        minWidth: rpx(320),
        flex: 1,
        paddingHorizontal: rpx(64),
        borderRadius: rpx(64),
        height: rpx(64),
        maxHeight: rpx(64),
        alignItems: "center",
    },
    magnify: {
        position: "absolute",
        left: rpx(24),
        zIndex: 1,
    },
    close: {
        position: "absolute",
        right: rpx(12),
    },
    resultWrapper: {
        width: "100%",
        flex: 1,
    },
});
