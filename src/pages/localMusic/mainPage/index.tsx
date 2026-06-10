import React from "react";
import LocalMusicSheet from "@/core/localMusicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import LocalMusicList from "./localMusicList";
import MusicBar from "@/components/musicBar";
import { localMusicSheetId } from "@/constants/commonConst";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";

export default function MainPage() {
    const navigate = useNavigate();
    const { t } = useI18N();

    function showScanResultReport(
        report: Awaited<ReturnType<typeof LocalMusicSheet.importLocal>>,
    ) {
        const repairedCount =
            report.exactMatchedCount + report.weakMatchedCount;
        const unchangedCount = Math.max(
            0,
            report.scannedCount - report.addedCount - repairedCount,
        );

        showDialog("SimpleDialog", {
            title: t("localMusic.scanResult.title"),
            content: [
                t("localMusic.scanResult.scanned", {
                    count: report.scannedCount,
                }),
                t("localMusic.scanResult.added", {
                    count: report.addedCount,
                }),
                t("localMusic.scanResult.exactMatched", {
                    count: report.exactMatchedCount,
                }),
                t("localMusic.scanResult.weakMatched", {
                    count: report.weakMatchedCount,
                }),
                t("localMusic.scanResult.unchanged", {
                    count: unchangedCount,
                }),
            ].join("\n"),
            okText: t("common.done"),
        });
    }

    return (
        <>
            <AppBar
                withStatusBar
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
                        title: t("localMusic.scanLocalMusic"),
                        async onPress() {
                            navigate(ROUTE_PATH.FILE_SELECTOR, {
                                fileType: "folder",
                                multi: true,
                                actionText: t("localMusic.beginScan"),
                                async onAction(selectedFiles) {
                                    return new Promise(resolve => {
                                        showDialog("LoadingDialog", {
                                            title: t("localMusic.scanLocalMusic"),
                                            promise:
                                                LocalMusicSheet.importLocal(
                                                    selectedFiles.map(
                                                        _ => _.path,
                                                    ),
                                                ),
                                            onResolve(data, hideDialog) {
                                                Toast.success(t("toast.importSuccess"));
                                                hideDialog();
                                                showScanResultReport(data);
                                                resolve(true);
                                            },
                                            onReject(reason, hideDialog) {
                                                if (reason?.message !== "Import Broken") {
                                                    Toast.warn(
                                                        reason?.message ?? "扫描本地音乐失败",
                                                    );
                                                }
                                                hideDialog();
                                                resolve(false);
                                            },
                                            onCancel(hideDialog) {
                                                LocalMusicSheet.cancelImportLocal();
                                                hideDialog();
                                                resolve(false);
                                            },
                                        });
                                    });
                                },
                            });
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
                {t("home.localMusic")}
            </AppBar>
            <LocalMusicList />
            <MusicBar />
        </>
    );
}
