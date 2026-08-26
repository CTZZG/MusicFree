import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import LocalMusicSheet from "@/core/localMusicSheet";
import { defaultLocalMusicScanPolicy } from "@/core/localMusicScanPolicy";
import type {
    ILocalMusicImportReport,
    ILocalMusicScanProgress,
    LocalMusicScanProgressListener,
} from "@/core/localMusicScanTypes";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { saveLocalMusicScanReport } from "@/core/localMusicScanReportStore";
import { GlobalState } from "@/utils/stateMapper";
import Toast from "@/utils/toast";
import React, { useCallback } from "react";

type ScanTask = (
    onProgress: LocalMusicScanProgressListener,
) => Promise<ILocalMusicImportReport>;

function ScanProgressText(props: {
    state: GlobalState<ILocalMusicScanProgress>;
}) {
    const { state } = props;
    const progress = state.useValue();
    const { t } = useI18N();
    const stageKey = `localMusic.scanProgress.${progress.stage}` as const;
    const hasKnownTotal = progress.total > 0;

    return (
        <ThemeText fontSize="title" fontWeight="semibold">
            {hasKnownTotal
                ? t(stageKey, {
                    completed: progress.completed,
                    total: progress.total,
                })
                : t(stageKey, {
                    completed: progress.completed,
                    total: "—",
                })}
        </ThemeText>
    );
}

const initialProgress: ILocalMusicScanProgress = {
    stage: "discovering",
    completed: 0,
    total: 0,
    cachedMetadataCount: 0,
    metadataWarningCount: 0,
};

export default function useLocalMusicScanFlow() {
    const { t } = useI18N();
    const navigate = useNavigate();

    return useCallback((task: ScanTask) => {
        return new Promise<boolean>(resolve => {
            let settled = false;
            const progressState = new GlobalState(initialProgress);
            const settle = (result: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(result);
                }
            };
            let promise: Promise<ILocalMusicImportReport>;
            try {
                promise = task(progress => progressState.setValue(progress));
            } catch (error) {
                promise = Promise.reject(error);
            }
            showDialog("LoadingDialog", {
                title: t("localMusic.scanLocalMusic"),
                loadingText: <ScanProgressText state={progressState} />,
                promise,
                onResolve(report, hideDialog) {
                    hideDialog();
                    Toast.success(t("toast.importSuccess"));
                    navigate(ROUTE_PATH.LOCAL_SCAN_RESULT, {
                        reportId: saveLocalMusicScanReport(report),
                    });
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
    }, [navigate, t]);
}

export function importFilteredLocalMusic(
    report: ILocalMusicImportReport,
    onProgress: LocalMusicScanProgressListener,
) {
    return LocalMusicSheet.importLocalCandidates(
        report.filteredItems.map(item => item.candidate),
        {
            ...defaultLocalMusicScanPolicy,
            minDurationSeconds: 0,
            minFileSizeBytes: 0,
            filterLikelySystemSounds: false,
        },
        onProgress,
    );
}

export function retryLocalMusicMetadata(
    report: ILocalMusicImportReport,
    onProgress: LocalMusicScanProgressListener,
) {
    return LocalMusicSheet.importLocalCandidates(
        report.metadataIssues.map(item => item.candidate),
        {
            minDurationSeconds: 0,
            minFileSizeBytes: 0,
            filterLikelySystemSounds: false,
        },
        onProgress,
    );
}
