import React from "react";
import LocalMusicSheet from "@/core/localMusicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import LocalMusicList from "./localMusicList";
import { localMusicSheetId } from "@/constants/commonConst";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import { ensureAndroidAudioReadPermission } from "@/utils/androidMediaPermission";
import StorageUri from "@/native/storageUri";
import { Platform } from "react-native";

export default function MainPage() {
    const navigate = useNavigate();
    const { t } = useI18N();

    function showScanResultToast(
        report: Awaited<ReturnType<typeof LocalMusicSheet.importLocal>>,
    ) {
        const repairedCount =
            report.exactMatchedCount + report.weakMatchedCount;

        Toast.success(t("localMusic.scanResult.summary", {
            scanned: report.scannedCount,
            added: report.addedCount,
            repaired: repairedCount,
            filtered: report.filteredCount,
        }));
    }

    function showScanProgress(
        promise: ReturnType<typeof LocalMusicSheet.importLocal>,
    ) {
        return new Promise<boolean>(resolve => {
            let settled = false;
            const settle = (result: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(result);
                }
            };
            showDialog("LoadingDialog", {
                title: t("localMusic.scanLocalMusic"),
                promise,
                onResolve(data, hideDialog) {
                    Toast.success(t("toast.importSuccess"));
                    hideDialog();
                    showScanResultToast(data);
                    settle(true);
                },
                onReject(reason, hideDialog) {
                    if (reason?.message !== "Import Broken") {
                        Toast.warn(
                            reason?.code === "E_URI_PERMISSION_REVOKED"
                                ? t("localMusic.folderPermissionRequired")
                                : reason?.message ??
                                      t("localMusic.scanFailed"),
                        );
                    }
                    hideDialog();
                    settle(false);
                },
                onCancel(hideDialog) {
                    LocalMusicSheet.cancelImportLocal();
                    hideDialog();
                    settle(false);
                },
            });
        });
    }

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
                                    LocalMusicSheet.importAndroidMediaStore(),
                                );
                                return;
                            }
                            navigate(ROUTE_PATH.FILE_SELECTOR, {
                                fileType: "folder",
                                multi: true,
                                actionText: t("localMusic.beginScan"),
                                async onAction(selectedFiles) {
                                    return showScanProgress(
                                        LocalMusicSheet.importLocal(
                                            selectedFiles.map(_ => _.path),
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
                                    LocalMusicSheet.importAndroidDirectory(
                                        directory.uri,
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
