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
// 列表里的 ⋮ 44 宽，往页边距里伸 12
const LIST_MANAGE_WIDTH = 44;
const LIST_MANAGE_OFFSET = -12;
// 网格里的 ⋮ 32 宽，往格间距里伸 6；点击范围左右各放宽 6 凑够 44，右边正好到下一格边上（格间距 12）
const TILE_MANAGE_OFFSET = -6;
const TILE_MANAGE_HIT_SLOP = { left: 6, right: 6 };

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
}) {
    const { sheet, width, list, pinned, group, onManage } = props;
    const colors = useColors();
    const navigate = useNavigate();
    const { t } = useI18N();
    const cover = sheet.coverImg ?? sheet.artwork;
    const title = sheet.title ?? "";
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
                // 长按和右边的 ⋮ 打开同一个菜单（置顶、分组、删除）
                onLongPress={onManage}>
                <View
                    style={[
                        styles.cover,
                        {
                            backgroundColor: colors.placeholder,
                            width: coverSize,
                            height: coverSize,
                        },
                    ]}>
                    {cover ? (
                        <FastImage
                            style={StyleSheet.absoluteFill}
                            source={cover}
                        />
                    ) : (
                        <Icon
                            name="musical-note"
                            size={Math.round(coverSize * 0.32)}
                            color={colors.textSecondary}
                        />
                    )}
                </View>
                <View style={list ? styles.listTexts : styles.tileTexts}>
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
            </Pressable>
            {/* 和歌曲行一样是不带底色的 ⋮。放在行外面而不是行里：行是一个无障碍
                节点，里面的按钮读屏软件点不到 */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("library.managePlaylist", { name: title })}
                hitSlop={list ? undefined : TILE_MANAGE_HIT_SLOP}
                onPress={onManage}
                style={({ pressed }) => [
                    list ? styles.listManage : [styles.tileManage, { top: width }],
                    pressed ? styles.pressed : null,
                ]}>
                <Icon
                    name="ellipsis-vertical"
                    size={18}
                    color={colors.textSecondary}
                />
            </Pressable>
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
    const favoriteTitle = t("home.favoriteSheet");
    const favoriteCount = sheets.find(sheet => sheet.id === favoriteId)?.worksNum ?? 0;
    // 「我喜欢」是播放页 ♥ 收歌的地方，不能删、改名、置顶或分组，放在上面的入口里；
    // 「我的歌单」只列自己建的和导入的（「编辑」页本来也只列这些）
    const userSheets = sheets.filter(sheet => sheet.id !== favoriteId);
    const sheetIds = sheets.map(sheet => sheet.id);
    const organization = normalizePlaylistOrganization(storedOrganization, sheetIds, favoriteId);
    const groups = [...new Set(Object.values(organization.groupBySheetId))].sort();
    // An empty/deleted group must not leave the whole library hidden.
    const activeGroup = selectedGroup && !groups.includes(selectedGroup) ? null : selectedGroup;
    const orderedSheets = selectLibraryPlaylists(
        userSheets, favoriteId, organization, query, activeGroup, favoriteTitle,
    );
    const currentSheetIds = () => MusicSheet.getSheets().map(sheet => sheet.id);
    const deleteSheet = (sheet: IMusic.IMusicSheetItemBase) => {
        showDialog("SimpleDialog", {
            title: t("dialog.deleteSheetTitle"),
            content: t("dialog.deleteSheetContent", {
                name: sheet.title,
            }),
            okText: t("common.delete"),
            cancelText: t("common.cancel"),
            onOk: async () => {
                await MusicSheet.removeSheet(sheet.id);
                // 删掉以后顺手清掉它的置顶和分组
                AppConfig.setConfig(
                    "library.playlistOrganization",
                    normalizePlaylistOrganization(
                        AppConfig.getConfig("library.playlistOrganization"),
                        currentSheetIds().filter(id => id !== sheet.id), favoriteId,
                    ),
                );
                Toast.success(t("toast.deleteSuccess"));
            },
        });
    };
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
                { title: t("sheetDetail.deleteSheet"), icon: "trash-outline", value: "delete" },
            ],
            onPress: item => {
                if (item.value === "pin") {
                    AppConfig.setConfig("library.playlistOrganization", togglePlaylistPin(
                        AppConfig.getConfig("library.playlistOrganization"), currentSheetIds(), favoriteId, sheet.id,
                    ));
                    return;
                }
                if (item.value === "delete") {
                    deleteSheet(sheet);
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
                    icon="heart-outline"
                    title={favoriteTitle}
                    // 和「收藏歌单」一样，有歌才在右边写数量
                    value={favoriteCount ? String(favoriteCount) : undefined}
                    // 读出「我喜欢，12首」，不只读一个数字
                    accessibilityLabel={
                        favoriteCount
                            ? `${favoriteTitle}，${t("home.songCount", { count: favoriteCount })}`
                            : undefined
                    }
                    accessory="chevron"
                    onPress={() =>
                        navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, { id: favoriteId })
                    }
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
                {userSheets.length ? (
                    <Pressable
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() =>
                            navigate(ROUTE_PATH.SHEET_EDITOR, { sheetType: "local" })
                        }
                        style={({ pressed }) => (pressed ? styles.pressed : null)}>
                        <ThemeText fontColor="primary">{t("common.edit")}</ThemeText>
                    </Pressable>
                ) : null}
            </View>
            {userSheets.length ? (
                <>
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
                            />
                        ))}
                    </View>
                    {!orderedSheets.length ? (
                        <ThemeText fontColor="textSecondary" style={styles.emptyText}>
                            {t("library.noMatchingPlaylists")}
                        </ThemeText>
                    ) : null}
                </>
            ) : (
                // 还没有自己的歌单：以前这里至少有个空的「我喜欢」占着，现在直接给出新建和导入
                <GroupedSection
                    title={t("library.noPlaylists")}
                    dividerInset={56}
                    style={styles.emptySection}>
                    <GroupedRow
                        plainIcon
                        icon="plus"
                        title={t("panel.createMusicSheet.title")}
                        onPress={() => showPanel("CreateMusicSheet")}
                    />
                    <GroupedRow
                        plainIcon
                        icon="inbox-arrow-down"
                        title={t("panel.importMusicSheet.title")}
                        onPress={() => showPanel("ImportMusicSheet")}
                    />
                </GroupedSection>
            )}
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
        // 给右边的 ⋮ 留位置
        paddingRight: LIST_MANAGE_WIDTH + LIST_MANAGE_OFFSET,
    },
    listItemWrapper: {
        position: "relative",
    },
    // 行高那么高、44 宽，往页边距里伸 12：⋮ 的中心离屏幕边 26 左右，和歌曲行的 ⋮、
    // 上面的「编辑」对齐
    listManage: {
        position: "absolute",
        right: LIST_MANAGE_OFFSET,
        top: 0,
        bottom: 0,
        width: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    // 网格里放在封面下面、名字右边（top 由封面边长决定），高 44 正好盖住名字和数量两行
    tileManage: {
        position: "absolute",
        right: TILE_MANAGE_OFFSET,
        width: 32,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
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
    // 名字和数量不伸到 ⋮ 底下
    tileTexts: {
        paddingRight: 32 + TILE_MANAGE_OFFSET,
    },
    emptySection: {
        marginTop: 0,
    },
    cover: {
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
    },
    tileTitle: {
        marginTop: 6,
    },
});
