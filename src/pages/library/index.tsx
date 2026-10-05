import React, { useState } from "react";
import {
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import FastImage from "@/components/base/fastImage";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import LargeTitleScrollView from "@/components/base/largeTitleScrollView";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { useDownloadQueue } from "@/core/downloader";
import { useI18N } from "@/core/i18n";
import MusicSheet, { useSheetsBase, useStarredSheets } from "@/core/musicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import Toast from "@/utils/toast";
import { getTileGrid, PAGE_MARGIN, TILE_GAP } from "@/utils/tileLayout";
import AppConfig, { useAppConfig } from "@/core/appConfig";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    assignPlaylistGroup,
    getPlaylistGroup,
    normalizePlaylistOrganization,
    selectLibraryPlaylists,
    togglePlaylistPin,
} from "@/core/libraryPlaylistOrganization";
import PlaylistGroupInput from "./playlistGroupInput";

// 歌单网格：手机上排三列（以前最窄 150，调大显示大小的手机上只排得下两列）
const MIN_TILE_WIDTH = 100;

function HeaderButton(props: {
    icon: IIconName;
    label: string;
    onPress: () => void;
}) {
    const colors = useColors();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.label}
            hitSlop={6}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.headerButton,
                { backgroundColor: colors.placeholder },
                pressed ? styles.pressed : null,
            ]}>
            <Icon name={props.icon} size={20} color={colors.primary} />
        </Pressable>
    );
}

function SheetItem(props: {
    sheet: IMusic.IMusicSheetItemBase;
    width: number;
    list: boolean;
    pinned: boolean;
    group?: string;
    onManage: () => void;
    onRemoved: () => void;
}) {
    const { sheet, width, list, pinned, group, onManage, onRemoved } = props;
    const colors = useColors();
    const navigate = useNavigate();
    const { t } = useI18N();
    const isFavorite = sheet.id === MusicSheet.defaultSheet.id;
    const cover = sheet.coverImg ?? sheet.artwork;
    const title = isFavorite ? t("home.favoriteSheet") : sheet.title ?? "";
    const count = t("home.songCount", { count: sheet.worksNum ?? 0 });
    const coverSize = list ? 48 : width;

    return (
        <View style={list ? styles.listItemWrapper : { width }}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${title}，${count}`}
                style={({ pressed }) => [
                    list ? styles.listItem : { width },
                    pressed ? styles.pressed : null,
                ]}
                onPress={() => {
                    navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, { id: sheet.id });
                }}
                onLongPress={() => {
                    if (isFavorite) {
                        return;
                    }
                    showDialog("SimpleDialog", {
                        title: t("dialog.deleteSheetTitle"),
                        content: t("dialog.deleteSheetContent", {
                            name: sheet.title,
                        }),
                        okText: t("common.delete"),
                        cancelText: t("common.cancel"),
                        onOk: async () => {
                            await MusicSheet.removeSheet(sheet.id);
                            onRemoved();
                            Toast.success(t("toast.deleteSuccess"));
                        },
                    });
                }}>
                <View
                    style={[
                        styles.cover,
                        isFavorite
                            ? styles.favoriteCover
                            : { backgroundColor: colors.placeholder },
                        { width: coverSize, height: coverSize },
                    ]}>
                    {cover ? (
                        <FastImage
                            style={StyleSheet.absoluteFill}
                            source={cover}
                        />
                    ) : (
                        <Icon
                            name={isFavorite ? "heart" : "musical-note"}
                            size={Math.round(coverSize * 0.32)}
                            color={isFavorite ? "#FFFFFF" : colors.textSecondary}
                        />
                    )}
                </View>
                <View style={list ? styles.listTexts : undefined}>
                    <ThemeText
                        numberOfLines={list ? 2 : 1}
                        fontSize="subTitle"
                        fontWeight="medium"
                        style={list ? undefined : styles.tileTitle}>
                        {title}
                    </ThemeText>
                    <ThemeText
                        numberOfLines={1}
                        fontSize="description"
                        fontColor="textSecondary">
                        {count}
                    </ThemeText>
                    {pinned || group ? (
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontColor="textSecondary"
                            accessibilityLabel={pinned ? t("library.pinned") : undefined}>
                            {[pinned ? t("library.pinned") : "", group].filter(Boolean).join(" · ")}
                        </ThemeText>
                    ) : null}
                </View>
                {list ? (
                    <Icon name="chevron-right" size={16} color={colors.textSecondary} />
                ) : null}
            </Pressable>
            {!isFavorite ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("library.managePlaylist", { name: title })}
                    hitSlop={4}
                    onPress={onManage}
                    style={[
                        list ? styles.listManage : styles.tileManage,
                        { backgroundColor: colors.card },
                    ]}>
                    <Icon name="ellipsis-vertical" size={18} color={colors.text} />
                </Pressable>
            ) : null}
        </View>
    );
}

/** 资料库标签：本地音乐、下载、历史等入口，歌单支持网格和列表 */
export default function Library() {
    const { t } = useI18N();
    const navigate = useNavigate();
    const { width: windowWidth } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const playlistView = useAppConfig("library.playlistView");
    const list = playlistView === "list";
    const sheets = useSheetsBase();
    const starredSheets = useStarredSheets();
    const downloadQueue = useDownloadQueue();
    const colors = useColors();
    const storedOrganization = useAppConfig("library.playlistOrganization");
    const [query, setQuery] = useState("");
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const favoriteId = MusicSheet.defaultSheet.id;
    const sheetIds = sheets.map(sheet => sheet.id);
    const organization = normalizePlaylistOrganization(storedOrganization, sheetIds, favoriteId);
    const groups = [...new Set(Object.values(organization.groupBySheetId))].sort();
    // An empty/deleted group must not leave the whole library hidden.
    const activeGroup = selectedGroup && !groups.includes(selectedGroup) ? null : selectedGroup;
    const orderedSheets = selectLibraryPlaylists(
        sheets, favoriteId, organization, query, activeGroup, t("home.favoriteSheet"),
    );
    const currentSheetIds = () => MusicSheet.getSheets().map(sheet => sheet.id);
    const saveGroup = (sheetId: string, name: string) => {
        AppConfig.setConfig("library.playlistOrganization", assignPlaylistGroup(
            AppConfig.getConfig("library.playlistOrganization"), currentSheetIds(), favoriteId, sheetId, name,
        ));
    };
    const manageSheet = (sheet: IMusic.IMusicSheetItemBase) => {
        const pinned = organization.pinnedIds.includes(sheet.id);
        showPanel("SimpleSelect", {
            header: sheet.title ?? "",
            candidates: [
                { title: t(pinned ? "library.unpinPlaylist" : "library.pinPlaylist"), icon: "bookmark-square", value: "pin" },
                { title: t("library.assignGroup"), icon: "folder-outline", value: "group" },
            ],
            onPress: item => {
                if (item.value === "pin") {
                    AppConfig.setConfig("library.playlistOrganization", togglePlaylistPin(
                        AppConfig.getConfig("library.playlistOrganization"), currentSheetIds(), favoriteId, sheet.id,
                    ));
                    return;
                }
                showPanel("SimpleSelect", {
                    header: t("library.assignGroup"),
                    candidates: [
                        { title: t("library.ungrouped"), value: "" },
                        ...groups.map(name => ({ title: name, value: name })),
                        { title: t("library.newGroup"), icon: "plus", value: null },
                    ],
                    onPress: groupItem => {
                        if (groupItem.value === null) {
                            let draftName = "";
                            // 和其他对话框一样「取消」在左、「确定」在右；组名为空时提示，对话框不关
                            showDialog("SimpleDialog", {
                                title: t("library.groupPlaylist", { name: sheet.title ?? "" }),
                                content: <PlaylistGroupInput onChange={value => {
                                    draftName = value;
                                }} />,
                                onOk: () => {
                                    if (!draftName.trim()) {
                                        Toast.warn(t("library.groupNameRequired"));
                                        return false;
                                    }
                                    saveGroup(sheet.id, draftName);
                                    Keyboard.dismiss();
                                },
                            });
                        } else {
                            saveGroup(sheet.id, groupItem.value);
                        }
                    },
                });
            },
        });
    };
    const { tileWidth } = getTileGrid(
        windowWidth - safeAreaInsets.left - safeAreaInsets.right,
        { minTileWidth: MIN_TILE_WIDTH },
    );

    return (
        <LargeTitleScrollView
            title={t("tabs.library")}
            actions={
                <>
                    <HeaderButton
                        icon="inbox-arrow-down"
                        label={t("home.importPlaylist.a11y")}
                        onPress={() => showPanel("ImportMusicSheet")}
                    />
                    <HeaderButton
                        icon="plus"
                        label={t("home.newPlaylist.a11y")}
                        onPress={() => showPanel("CreateMusicSheet")}
                    />
                    <HeaderButton
                        icon={list ? "squares-2x2" : "bars-3"}
                        label={t(
                            list ? "library.switchToGrid" : "library.switchToList",
                        )}
                        onPress={() => AppConfig.setConfig(
                            "library.playlistView",
                            list ? "grid" : "list",
                        )}
                    />
                </>
            }>
            <GroupedSection dividerInset={56}>
                <GroupedRow
                    plainIcon
                    icon="folder-music-outline"
                    title={t("home.localMusic")}
                    accessory="chevron"
                    onPress={() => navigate(ROUTE_PATH.LOCAL)}
                />
                <GroupedRow
                    plainIcon
                    icon="arrow-down-tray"
                    title={t("downloading.title")}
                    value={
                        downloadQueue.length
                            ? t("library.downloadingCount", {
                                count: downloadQueue.length,
                            })
                            : undefined
                    }
                    accessory="chevron"
                    onPress={() => navigate(ROUTE_PATH.DOWNLOADING)}
                />
                <GroupedRow
                    plainIcon
                    icon="clock-outline"
                    title={t("home.playHistory")}
                    accessory="chevron"
                    onPress={() => navigate(ROUTE_PATH.HISTORY)}
                />
                <GroupedRow
                    plainIcon
                    icon="strategy"
                    title={t("home.smartSheets")}
                    accessory="chevron"
                    onPress={() => navigate(ROUTE_PATH.SMART_SHEETS)}
                />
                <GroupedRow
                    plainIcon
                    icon="bookmark-square"
                    title={t("home.starredPlaylists")}
                    value={
                        starredSheets.length
                            ? String(starredSheets.length)
                            : undefined
                    }
                    accessory="chevron"
                    onPress={() =>
                        navigate(ROUTE_PATH.SHEET_BROWSER, {
                            sheetType: "starred",
                        })
                    }
                />
            </GroupedSection>

            <View style={styles.sectionHeader}>
                <ThemeText
                    accessibilityRole="header"
                    fontSize="title"
                    fontWeight="bold"
                    style={styles.sectionTitle}>
                    {t("home.myPlaylists")}
                </ThemeText>
                <Pressable
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() =>
                        navigate(ROUTE_PATH.SHEET_EDITOR, { sheetType: "local" })
                    }
                    style={({ pressed }) => (pressed ? styles.pressed : null)}>
                    <ThemeText fontColor="primary">{t("common.edit")}</ThemeText>
                </Pressable>
            </View>
            <View style={styles.searchField}>
                <Icon name="magnifying-glass" size={20} color={colors.textSecondary} />
                <TextInput
                    testID="library-playlist-search"
                    accessibilityLabel={t("library.searchPlaylists")}
                    placeholder={t("library.searchPlaylists")}
                    placeholderTextColor={colors.textSecondary}
                    value={query}
                    onChangeText={setQuery}
                    returnKeyType="search"
                    onSubmitEditing={Keyboard.dismiss}
                    style={[styles.searchInput, { color: colors.text }]}
                />
                {query ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.clear")}
                        onPress={() => setQuery("")}
                        style={styles.smallButton}>
                        <Icon name="x-mark" size={18} color={colors.textSecondary} />
                    </Pressable>
                ) : null}
            </View>
            {groups.length ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.groupFilters}
                    contentContainerStyle={styles.groupFilterContent}>
                    {[
                        { title: t("library.allGroups"), value: null },
                        ...groups.map(name => ({ title: name, value: name })),
                        { title: t("library.ungrouped"), value: "" },
                    ].map(filter => (
                        <Pressable
                            key={filter.value === null ? "all" : `group:${filter.value}`}
                            accessibilityRole="button"
                            accessibilityLabel={filter.title}
                            accessibilityState={{ selected: activeGroup === filter.value }}
                            onPress={() => setSelectedGroup(filter.value)}
                            style={[
                                styles.groupFilter,
                                { backgroundColor: activeGroup === filter.value ? colors.primary : colors.placeholder },
                            ]}>
                            <ThemeText
                                numberOfLines={1}
                                color={activeGroup === filter.value ? "#FFFFFF" : colors.text}>
                                {filter.title}
                            </ThemeText>
                        </Pressable>
                    ))}
                </ScrollView>
            ) : null}
            <View
                testID={list ? "library-playlist-list" : "library-playlist-grid"}
                style={list ? styles.list : styles.grid}>
                {orderedSheets.map(sheet => (
                    <SheetItem
                        key={sheet.id}
                        sheet={sheet}
                        width={tileWidth}
                        list={list}
                        pinned={organization.pinnedIds.includes(sheet.id)}
                        group={getPlaylistGroup(organization, sheet.id)}
                        onManage={() => manageSheet(sheet)}
                        onRemoved={() => AppConfig.setConfig(
                            "library.playlistOrganization",
                            normalizePlaylistOrganization(
                                AppConfig.getConfig("library.playlistOrganization"),
                                currentSheetIds().filter(id => id !== sheet.id), favoriteId,
                            ),
                        )}
                    />
                ))}
            </View>
            {!orderedSheets.length ? (
                <ThemeText fontColor="textSecondary" style={styles.emptyText}>
                    {t("library.noMatchingPlaylists")}
                </ThemeText>
            ) : null}
        </LargeTitleScrollView>
    );
}

const styles = StyleSheet.create({
    headerButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.6,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: PAGE_MARGIN,
        marginTop: 24,
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 20,
        lineHeight: 25,
    },
    grid: {
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: PAGE_MARGIN,
        columnGap: TILE_GAP,
        rowGap: 16,
    },
    list: {
        paddingHorizontal: PAGE_MARGIN,
    },
    listItem: {
        flexDirection: "row",
        alignItems: "center",
        minHeight: 64,
        paddingVertical: 8,
        gap: 12,
        paddingRight: 44,
    },
    listItemWrapper: {
        position: "relative",
    },
    listManage: {
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        minWidth: 40,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 20,
    },
    tileManage: {
        position: "absolute",
        right: 4,
        top: 4,
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
    },
    searchField: {
        marginHorizontal: PAGE_MARGIN,
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        marginBottom: 10,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        fontSize: 15,
        paddingVertical: 8,
    },
    smallButton: {
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    groupFilters: {
        marginBottom: 12,
        flexGrow: 0,
    },
    groupFilterContent: {
        paddingHorizontal: PAGE_MARGIN,
        gap: 8,
    },
    groupFilter: {
        minHeight: 44,
        justifyContent: "center",
        borderRadius: 22,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    emptyText: {
        paddingHorizontal: PAGE_MARGIN,
        paddingVertical: 24,
    },
    listTexts: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    cover: {
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
    },
    // “我喜欢”没有封面时用粉红底配白色爱心
    favoriteCover: {
        backgroundColor: "#F2456B",
    },
    tileTitle: {
        marginTop: 6,
    },
});
