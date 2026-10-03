import React from "react";
import {
    Pressable,
    StyleSheet,
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

function SheetTile(props: {
    sheet: IMusic.IMusicSheetItemBase;
    width: number;
}) {
    const { sheet, width } = props;
    const colors = useColors();
    const navigate = useNavigate();
    const { t } = useI18N();
    const isFavorite = sheet.id === MusicSheet.defaultSheet.id;
    const cover = sheet.coverImg ?? sheet.artwork;
    const title = isFavorite ? t("home.favoriteSheet") : sheet.title ?? "";
    const count = t("home.songCount", { count: sheet.worksNum ?? 0 });

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}，${count}`}
            style={({ pressed }) => [
                { width },
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
                    { width, height: width },
                ]}>
                {cover ? (
                    <FastImage
                        style={StyleSheet.absoluteFill}
                        source={cover}
                    />
                ) : (
                    <Icon
                        name={isFavorite ? "heart" : "musical-note"}
                        size={Math.round(width * 0.32)}
                        color={isFavorite ? "#FFFFFF" : colors.textSecondary}
                    />
                )}
            </View>
            <ThemeText
                numberOfLines={1}
                fontSize="subTitle"
                fontWeight="medium"
                style={styles.tileTitle}>
                {title}
            </ThemeText>
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontColor="textSecondary">
                {count}
            </ThemeText>
        </Pressable>
    );
}

/** 资料库标签：本地音乐、下载、历史等入口，下面是自建歌单的网格 */
export default function Library() {
    const { t } = useI18N();
    const navigate = useNavigate();
    const { width: windowWidth } = useWindowDimensions();
    const sheets = useSheetsBase();
    const starredSheets = useStarredSheets();
    const downloadQueue = useDownloadQueue();

    // “我喜欢”放第一个，其余保持原有顺序
    const orderedSheets = [
        ...sheets.filter(sheet => sheet.id === MusicSheet.defaultSheet.id),
        ...sheets.filter(sheet => sheet.id !== MusicSheet.defaultSheet.id),
    ];
    const { tileWidth } = getTileGrid(windowWidth, {
        minTileWidth: MIN_TILE_WIDTH,
    });

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
            <View style={styles.grid}>
                {orderedSheets.map(sheet => (
                    <SheetTile key={sheet.id} sheet={sheet} width={tileWidth} />
                ))}
            </View>
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
