import Empty from "@/components/base/empty";
import IconButton from "@/components/base/iconButton";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { ImgAsset } from "@/constants/assetsConst";
import { localPluginPlatform } from "@/constants/commonConst";
import i18n, { useI18N } from "@/core/i18n";
import MusicSheet, { useSheetsBase, useStarredSheets } from "@/core/musicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import { FlashList } from "@shopify/flash-list";
import Color from "color";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";

interface ISheetsProps {
    initialSheetType?: "local" | "starred";
    variant?: "classic";
}

export default function Sheets(props: ISheetsProps) {
    const { initialSheetType, variant } = props;
    const initialIndex = initialSheetType === "starred" ? 1 : 0;
    const [index, setIndex] = useState(initialIndex);
    const colors = useColors();
    const navigate = useNavigate();

    const allSheets = useSheetsBase();
    const staredSheets = useStarredSheets();
    const { t } = useI18N();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));
    const reserveMusicBarInset = variant !== "classic";

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    const selectedTabTextStyle = useMemo(() => {
        return [
            styles.selectTabText,
            {
                borderBottomColor: colors.primary,
            },
        ];
    }, [colors]);


    return (
        <>
            <View
                style={[
                    styles.subTitleContainer,
                    variant === "classic" ? styles.classicSubTitleContainer : null,
                ]}>
                <Pressable
                    style={styles.tabContainer}
                    accessible
                    accessibilityLabel={t("home.myPlaylistsCount.a11y", {
                        count: allSheets.length,
                    })}
                    onPress={() => {
                        setIndex(0);
                    }}>
                    <ThemeText
                        accessible={false}
                        fontSize="title"
                        style={[
                            styles.tabText,
                            index === 0 ? selectedTabTextStyle : null,
                        ]}>
                        {t("home.myPlaylists")}
                    </ThemeText>
                    <ThemeText
                        accessible={false}
                        fontColor="textSecondary"
                        fontSize="subTitle"
                        style={styles.tabText}>
                        {" "}
                        ({allSheets.length})
                    </ThemeText>
                </Pressable>
                <Pressable
                    style={styles.tabContainer}
                    accessible
                    accessibilityLabel={t("home.starredPlaylistsCount.a11y", {
                        count: staredSheets.length,
                    })}
                    onPress={() => {
                        setIndex(1);
                    }}>
                    <ThemeText
                        fontSize="title"
                        accessible={false}
                        style={[
                            styles.tabText,
                            index === 1 ? selectedTabTextStyle : null,
                        ]}>
                        {t("home.starredPlaylists")}
                    </ThemeText>
                    <ThemeText
                        fontColor="textSecondary"
                        fontSize="subTitle"
                        accessible={false}
                        style={styles.tabText}>
                        {" "}
                        ({staredSheets.length})
                    </ThemeText>
                </Pressable>
                <View style={styles.more}>
                    <IconButton
                        name="plus"
                        style={styles.newSheetButton}
                        sizeType="normal"
                        accessibilityLabel={t("home.newPlaylist.a11y")}
                        onPress={() => {
                            showPanel("CreateMusicSheet");
                        }}
                    />
                    <IconButton name='ellipsis-vertical' sizeType="normal" onPress={() => {
                        showPanel("SimpleSelect", {
                            header: i18n.t("home.playlistManagement.a11y"),
                            height: rpx(480),
                            candidates: [{
                                title: i18n.t("home.playById.a11y"),
                                icon: "identification",
                                value: "playById",
                            }, {
                                title: i18n.t("home.managePlaylists.a11y"),
                                icon: "pencil-square",
                                value: "manageSheets",
                            }, {
                                title: i18n.t("home.importPlaylist.a11y"),
                                icon: "inbox-arrow-down",
                                value: "importSheets",
                            }],
                            onPress(item) {
                                if (item.value === "playById") {
                                    showPanel("PlayById");
                                } else if (item.value === "manageSheets") {
                                    navigate(ROUTE_PATH.SHEET_EDITOR, {
                                        sheetType: index === 0 ? "local" : "starred",
                                    });
                                } else if (item.value === "importSheets") {
                                    showPanel("ImportMusicSheet");
                                }
                            },
                        });
                    }} />
                </View>
            </View>
            <FlashList
                ListEmptyComponent={<Empty />}
                ListFooterComponent={
                    reserveMusicBarInset && musicBarBottomInset ? (
                        <View style={{ height: musicBarBottomInset }} />
                    ) : null
                }
                extraData={{ t }}
                data={(index === 0 ? allSheets : staredSheets) ?? []}
                renderItem={({ item: sheet }) => {
                    const isLocalSheet = !(
                        sheet.platform && sheet.platform !== localPluginPlatform
                    );
                    const sheetItem = (
                        <ListItem
                            key={`${sheet.id}`}
                            heightType="big"
                            withHorizontalPadding
                            style={[
                                variant === "classic"
                                    ? styles.classicSheetItem
                                    : null,
                                variant === "classic"
                                    ? {
                                        backgroundColor: colors.card,
                                        borderColor: Color(colors.text)
                                            .alpha(0.06)
                                            .toString(),
                                    }
                                    : null,
                            ]}
                            onPress={() => {
                                if (isLocalSheet) {
                                    navigate(ROUTE_PATH.LOCAL_SHEET_DETAIL, {
                                        id: sheet.id,
                                    });
                                } else {
                                    navigate(ROUTE_PATH.PLUGIN_SHEET_DETAIL, {
                                        sheetInfo: sheet,
                                    });
                                }
                            }}
                            onLongPress={() => {
                                if (isLocalSheet && sheet.id === MusicSheet.defaultSheet.id) {
                                    return;
                                }
                                showDialog("SimpleDialog", {
                                    title: i18n.t("dialog.deleteSheetTitle"),
                                    content: i18n.t("dialog.deleteSheetContent", {
                                        name: sheet.title,
                                    }),
                                    okText: i18n.t("common.delete"),
                                    cancelText: i18n.t("common.cancel"),
                                    onOk: async () => {
                                        if (isLocalSheet) {
                                            await MusicSheet.removeSheet(
                                                sheet.id,
                                            );
                                            Toast.success(t("toast.deleteSuccess"));
                                        } else {
                                            await MusicSheet.unstarMusicSheet(
                                                sheet,
                                            );
                                            Toast.success(t("toast.hasUnstarred"));
                                        }
                                    },
                                });
                            }}
                        >
                            <ListItem.ListItemImage
                                uri={sheet.coverImg ?? sheet.artwork}
                                fallbackImg={ImgAsset.albumDefault}
                                maskIcon={
                                    sheet.id === MusicSheet.defaultSheet.id
                                        ? "heart"
                                        : null
                                }
                            />
                            <ListItem.Content
                                title={sheet.title}
                                description={
                                    isLocalSheet
                                        ? t("home.songCount", { count: sheet.worksNum })
                                        : `${sheet.artist ?? ""}`
                                }
                            />
                        </ListItem>
                    );
                    return variant === "classic" ? (
                        <View style={styles.classicSheetItemOuter}>
                            {sheetItem}
                        </View>
                    ) : (
                        sheetItem
                    );
                }}
                nestedScrollEnabled
            />
        </>
    );
}

const styles = StyleSheet.create({
    subTitleContainer: {
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "flex-start",
        marginBottom: rpx(12),
    },
    classicSubTitleContainer: {
        marginTop: rpx(24),
    },
    classicSheetItemOuter: {
        paddingHorizontal: rpx(24),
        marginBottom: rpx(12),
    },
    classicSheetItem: {
        borderRadius: rpx(18),
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    subTitleLeft: {
        flexDirection: "row",
    },
    tabContainer: {
        flexDirection: "row",
        marginRight: rpx(32),
    },

    tabText: {
        lineHeight: rpx(60),
    },
    selectTabText: {
        borderBottomWidth: rpx(6),
        fontWeight: "bold",
    },
    more: {
        height: rpx(64),
        marginTop: rpx(3),
        flexGrow: 1,
        flexDirection: "row",
        justifyContent: "flex-end",
    },
    newSheetButton: {
        marginRight: rpx(24),
    },
});
