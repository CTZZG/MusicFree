import React from "react";
import LocalMusicSheet from "@/core/localMusicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import LocalMusicList from "./localMusicList";
import { localMusicSheetId } from "@/constants/commonConst";
import Toast from "@/utils/toast";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import { ensureAndroidAudioReadPermission } from "@/utils/androidMediaPermission";
import StorageUri from "@/native/storageUri";
import { Platform } from "react-native";
import { useAppConfig } from "@/core/appConfig";
import { normalizeLocalMusicScanPolicy } from "@/core/localMusicScanPolicy";
import useLocalMusicScanFlow from "../scanFlow";

export default function MainPage() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const storedScanPolicy = useAppConfig("localMusic.scanPolicy");
    const scanPolicy = normalizeLocalMusicScanPolicy(storedScanPolicy);
    const showScanProgress = useLocalMusicScanFlow();

    return (
        <>
            <AppBar
                withStatusBar
                backgroundColor="transparent"
                spacious
                menuIcon="bars-3"
                menuPosition="left"
                actions={[
                    {
                        icon: "magnifying-glass",
                        onPress() {
                            navigate(ROUTE_PATH.SEARCH_MUSIC_LIST, {
                                musicList: LocalMusicSheet.getMusicList(),
                            });
                        },
                    },
                ]}
                menu={[
                    {
                        icon: "cog-8-tooth",
                        title: t("localMusic.scanSettings.title"),
                        onPress() {
                            navigate(ROUTE_PATH.LOCAL_SCAN_SETTINGS);
                        },
                    },
                    {
                        icon: "magnifying-glass",
                        title:
                            Platform.OS === "android"
                                ? t("localMusic.scanSystemLibrary")
                                : t("localMusic.scanLocalMusic"),
                        async onPress() {
                            if (Platform.OS === "android") {
                                if (
                                    !await ensureAndroidAudioReadPermission()
                                ) {
                                    Toast.warn(
                                        t(
                                            "localMusic.audioPermissionRequired",
                                        ),
                                    );
                                    return;
                                }
                                showScanProgress(
                                    onProgress =>
                                        LocalMusicSheet.importAndroidMediaStore(
                                            scanPolicy,
                                            onProgress,
                                        ),
                                );
                                return;
                            }
                            navigate(ROUTE_PATH.FILE_SELECTOR, {
                                fileType: "folder",
                                multi: true,
                                actionText: t("localMusic.beginScan"),
                                async onAction(selectedFiles) {
                                    return showScanProgress(
                                        onProgress => LocalMusicSheet.importLocal(
                                            selectedFiles.map(_ => _.path),
                                            scanPolicy,
                                            onProgress,
                                        ),
                                    );
                                },
                            });
                        },
                    },
                    {
                        icon: "folder-music-outline",
                        title: t("localMusic.scanFolder"),
                        show: Platform.OS === "android",
                        async onPress() {
                            try {
                                const directory =
                                    await StorageUri.pickDirectory();
                                if (!directory) {
                                    return;
                                }
                                if (!directory.persisted) {
                                    Toast.warn(
                                        t(
                                            "localMusic.folderPermissionRequired",
                                        ),
                                    );
                                    return;
                                }
                                showScanProgress(
                                    onProgress =>
                                        LocalMusicSheet.importAndroidDirectory(
                                            directory.uri,
                                            scanPolicy,
                                            onProgress,
                                        ),
                                );
                            } catch (reason: any) {
                                Toast.warn(
                                    reason?.message ??
                                        t("localMusic.scanFailed"),
                                );
                            }
                        },
                    },
                    {
                        icon: "pencil-square",
                        title: t("common.batchEdit"),
                        async onPress() {
                            navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                                musicList: LocalMusicSheet.getMusicList(),
                                musicSheet: {
                                    id: localMusicSheetId,
                                },
                            });
                        },
                    },
                    {
                        icon: "arrow-down-tray",
                        title: t("localMusic.downloadList"),
                        async onPress() {
                            navigate(ROUTE_PATH.DOWNLOADING);
                        },
                    },
                ]}>
                {t("localMusic.title")}
            </AppBar>
            <LocalMusicList />
        </>
    );
}
