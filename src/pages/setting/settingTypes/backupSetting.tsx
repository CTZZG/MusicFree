import ListItem, { ListItemHeader } from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import Backup, {
    IBackupPreview,
    IBackupResumeReport,
    IBackupResumeSectionReport,
} from "@/core/backup";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Toast from "@/utils/toast";
import React from "react";
import { Platform, ScrollView, StyleSheet } from "react-native";

import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";

import { ResumeMode } from "@/constants/commonConst.ts";
import Config, {
    getCredentialMigrationError,
    retryLegacyCredentialMigration,
    useAppConfig,
} from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import {
    backupToWebdav,
    formatBackupTimestamp,
    getWebdavBackupCandidates,
    hasConfiguredWebdav,
    readWebdavBackup,
    type IWebdavAutoBackupInterval,
} from "@/core/webdavBackup";
import delay from "@/utils/delay";
import { checkAndCreateDir, writeInChunks } from "@/utils/fileUtils.ts";
import { errorLog } from "@/utils/log.ts";
import PersistStatus from "@/utils/persistStatus";
import { getDocumentAsync } from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { DocumentDirectoryPath, unlink } from "react-native-fs";
import Clipboard from "@react-native-clipboard/clipboard";
import SecureCredential, {
    setCredentialVerified,
    webdavPasswordCredentialKey,
} from "@/native/secureCredential";
import StorageUri from "@/native/storageUri";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";
import { createWebdavSettingsTransaction } from "./webdavSettingsTransaction";

const preRestoreBackupDir = `${DocumentDirectoryPath}/MusicFree`;
const remoteBackupHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 32 * 1024 * 1024,
});

export default function BackupSetting() {
    const { t } = useI18N();
    const navigate = useNavigate();

    const resumeMode = useAppConfig("backup.resumeMode");
    // 启动时的凭据迁移只跑一次，因此读一次初值即可；重试成功后本地清掉。
    const [credentialMigrationError, setCredentialMigrationError] =
        React.useState(getCredentialMigrationError);
    const webdavUrl = useAppConfig("webdav.url");
    const webdavUsername = useAppConfig("webdav.username");
    const webdavAutoBackupInterval =
        useAppConfig("webdav.autoBackupInterval") ?? "off";
    const webdavAutoBackupWifiOnly =
        useAppConfig("webdav.autoBackupWifiOnly") ?? true;
    const webdavAutoBackupLastSuccessAt = PersistStatus.useValue(
        "backup.webdavAutoBackupLastSuccessAt",
    );
    const webdavAutoBackupLastFailedAt = PersistStatus.useValue(
        "backup.webdavAutoBackupLastFailedAt",
    );
    const webdavAutoBackupLastError = PersistStatus.useValue(
        "backup.webdavAutoBackupLastError",
    );
    const webdavAutoBackupLastSkippedAt = PersistStatus.useValue(
        "backup.webdavAutoBackupLastSkippedAt",
    );
    const webdavAutoBackupLastSkipReason = PersistStatus.useValue(
        "backup.webdavAutoBackupLastSkipReason",
    );

    function padTime(value: number) {
        return `${value}`.padStart(2, "0");
    }

    function formatLocalTime(timestamp: number) {
        const date = new Date(timestamp);
        return [
            `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(
                date.getDate(),
            )}`,
            `${padTime(date.getHours())}:${padTime(date.getMinutes())}`,
        ].join(" ");
    }

    function getResumeModeTitle(mode?: ResumeMode) {
        return t(
            (`backupAndResume.resumeMode.${mode || ResumeMode.Append}`) as any,
        );
    }

    function formatResumePreview(preview: IBackupPreview) {
        return [
            `${t("backupAndResume.resumeMode")}: ${getResumeModeTitle(
                resumeMode as ResumeMode,
            )}`,
            `${t("backupAndResume.report.musicSheets")}: ${preview.musicSheetCount}`,
            `${t("backupAndResume.report.musicItems")}: ${preview.musicCount}`,
            `${t("backupAndResume.report.localMusic")}: ${preview.localMusicCount}`,
            `${t("backupAndResume.report.starredMusicSheets")}: ${preview.starredMusicSheetCount}`,
            `${t("backupAndResume.report.plugins")}: ${preview.pluginCount}`,
            `${t("backupAndResume.report.pluginConfigs")}: ${preview.pluginConfigCount}`,
            preview.invalidPluginCount
                ? `${t("backupAndResume.report.invalidPlugins")}: ${preview.invalidPluginCount}`
                : "",
        ].filter(Boolean).join("\n");
    }

    function formatResumeSection(
        label: string,
        section: IBackupResumeSectionReport,
    ) {
        return `${label}: ${t("backupAndResume.report.success")} ${section.successCount}, ${t("backupAndResume.report.skipped")} ${section.skippedCount}, ${t("backupAndResume.report.failed")} ${section.failedCount}`;
    }

    function formatResumeReport(report: IBackupResumeReport) {
        const failureReasons = [
            ...report.musicSheets.failureReasons,
            ...report.localMusicSheet.failureReasons,
            ...report.starredMusicSheets.failureReasons,
            ...report.plugins.failureReasons,
            ...report.pluginConfigs.failureReasons,
            report.preRestoreBackup?.success === false
                ? `${t("backupAndResume.report.preRestoreBackup")}: ${
                    report.preRestoreBackup.error ?? ""
                }`
                : "",
        ].filter(Boolean);

        return [
            `${t("backupAndResume.resumeMode")}: ${getResumeModeTitle(
                report.resumeMode,
            )}`,
            report.preRestoreBackup
                ? `${t("backupAndResume.report.preRestoreBackup")}: ${
                    report.preRestoreBackup.success
                        ? report.preRestoreBackup.path
                        : t("backupAndResume.report.failed")
                }`
                : "",
            formatResumeSection(
                t("backupAndResume.report.musicSheets"),
                report.musicSheets,
            ),
            formatResumeSection(
                t("backupAndResume.report.localMusic"),
                report.localMusicSheet,
            ),
            formatResumeSection(
                t("backupAndResume.report.starredMusicSheets"),
                report.starredMusicSheets,
            ),
            formatResumeSection(
                t("backupAndResume.report.plugins"),
                report.plugins,
            ),
            formatResumeSection(
                t("backupAndResume.report.pluginConfigs"),
                report.pluginConfigs,
            ),
            failureReasons.length
                ? [
                    "",
                    t("backupAndResume.report.failureReasons"),
                    ...failureReasons.map(reason => `- ${reason}`),
                ].join("\n")
                : "",
        ].filter(Boolean).join("\n");
    }

    function showResumeReport(report: IBackupResumeReport) {
        const reportText = formatResumeReport(report);
        showDialog("SimpleDialog", {
            title: t("backupAndResume.resumeReportTitle"),
            content: reportText,
            okText: t("backupAndResume.copyResumeReport"),
            onOk() {
                Clipboard.setString(reportText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    async function createPreRestoreBackup() {
        try {
            await checkAndCreateDir(preRestoreBackupDir);
            const path =
                `${preRestoreBackupDir}/backup-before-restore-${formatBackupTimestamp()}.json`;
            await writeInChunks(path, Backup.backup());
            return {
                success: true,
                path,
            };
        } catch (e: any) {
            errorLog("恢复前自动备份失败", e);
            return {
                success: false,
                error: e?.message ?? `${e}`,
            };
        }
    }

    function showResumeLoading(raw: string | object) {
        return new Promise(resolve => {
            showDialog("LoadingDialog", {
                title: t("sidebar.backupAndResume"),
                loadingText: t("backupAndResume.resuming"),
                async task() {
                    await delay(300, false);
                    const preRestoreBackup = await createPreRestoreBackup();
                    const report = await Backup.resume(raw, resumeMode);
                    report.preRestoreBackup = preRestoreBackup;
                    return report;
                },
                onResolve(report, hideDialog) {
                    hideDialog();
                    Toast.success(t("toast.resumeSuccess"));
                    showResumeReport(report);
                    resolve(true);
                },
                onReject(reason, hideDialog) {
                    hideDialog();
                    resolve(false);
                    Toast.warn(t("toast.resumeFail", {
                        reason: reason?.message ?? reason,
                    }));
                },
            });
        });
    }

    function showResumePreview(raw: string | object) {
        try {
            const preview = Backup.preview(raw);
            const previewText = formatResumePreview(preview);
            showDialog("SimpleDialog", {
                title: t("backupAndResume.resumePreviewTitle"),
                content: previewText,
                okText: t("backupAndResume.startResume"),
                extraActions: [
                    {
                        title: t("backupAndResume.copyResumePreview"),
                        type: "normal",
                        onPress() {
                            Clipboard.setString(previewText);
                            Toast.success(t("toast.copiedToClipboard"));
                        },
                    },
                ],
                onOk() {
                    setTimeout(() => {
                        showResumeLoading(raw);
                    }, 0);
                },
            });
        } catch (e: any) {
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    const onBackupToLocal = async () => {
        if (Platform.OS === "android") {
            const exportPath =
                `${preRestoreBackupDir}/backup-export-${Date.now()}.json`;
            showDialog("LoadingDialog", {
                title: t("backupAndResume.backupDialogTitle"),
                loadingText: t("backupAndResume.backuping"),
                promise: (async () => {
                    await checkAndCreateDir(preRestoreBackupDir);
                    await writeInChunks(exportPath, Backup.backup());
                    try {
                        return await StorageUri.exportDocument(
                            exportPath,
                            "application/json",
                            "musicfree-backup.json",
                        );
                    } finally {
                        await unlink(exportPath).catch(() => undefined);
                    }
                })(),
                // 备份是「只写新文件」，放弃等待不会改动任何既有数据，
                // 因此允许用户退出对话框；恢复（showResumeLoading）不给取消，
                // 因为那会在改数据的中途让用户误以为已停止。
                onCancel(hideDialog) {
                    hideDialog();
                },
                onResolve(result, hideDialog) {
                    hideDialog();
                    if (result) {
                        Toast.success(t("toast.backupSuccess"));
                    }
                },
                onReject(reason, hideDialog) {
                    hideDialog();
                    Toast.warn(t("toast.backupFail", {
                        reason: reason?.message ?? reason,
                    }));
                },
            });
            return;
        }
        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("backupAndResume.beginBackup"),
            async onAction(selectedFiles) {
                const raw = Backup.backup();
                const folder = selectedFiles[0]?.path;
                return new Promise(resolve => {
                    showDialog("LoadingDialog", {
                        title: t("backupAndResume.backupDialogTitle"),
                        loadingText: t("backupAndResume.backuping"),
                        promise: writeInChunks(
                            `${folder}${folder?.endsWith("/") ? "" : "/"
                            }backup.json`,
                            raw,
                        ),
                        // 同上：写出备份文件，放弃等待不影响既有数据。
                        onCancel(hideDialog) {
                            hideDialog();
                            resolve(false);
                        },
                        onResolve(_, hideDialog) {
                            Toast.success(t("toast.backupSuccess"));
                            hideDialog();
                            resolve(true);
                        },
                        onReject(reason, hideDialog) {
                            hideDialog();
                            resolve(false);
                            Toast.warn(t("toast.backupFail", { reason: reason?.message ?? reason }));
                        },
                    });
                });
            },
        });
    };

    async function onResumeFromLocal() {
        try {
            const pickResult = await getDocumentAsync({
                copyToCacheDirectory: true,
                type: "application/json",
            });
            if (pickResult.canceled) {
                return;
            }
            const result = await readAsStringAsync(pickResult.assets[0].uri);
            showResumePreview(result);
        } catch (e: any) {
            errorLog("恢复失败", e);
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onResumeFromUrl() {
        showPanel("SimpleInput", {
            title: t("backupAndResume.resumeFromUrlDialogTitle"),
            placeholder: t("backupAndResume.resumeFromUrlDialogPlaceHolder"),
            maxLength: 1024,
            async onOk(text, closePanel) {
                try {
                    const url = text.trim();
                    if (url.endsWith(".json") || url.endsWith(".txt")) {
                        const raw = String(
                            (await remoteBackupHttpClient.get(url)).data ?? "",
                        );
                        closePanel();
                        setTimeout(() => {
                            showResumePreview(raw);
                        }, 0);
                    } else {
                        throw new Error("无效的URL");
                    }
                } catch (e: any) {
                    Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
                }
            },
        });
    }

    async function onResumeFromWebdav() {
        async function showWebdavResumePreview(path: string) {
            try {
                const resumeData = await readWebdavBackup(path);
                showResumePreview(resumeData);
            } catch (e: any) {
                Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
            }
        }

        try {
            if (!(await hasConfiguredWebdav())) {
                Toast.warn(t("toast.resumePreCheckFailed"));
                return;
            }
            const candidates = (await getWebdavBackupCandidates()).map(
                item => ({
                    title:
                        item.type === "latest"
                            ? t("backupAndResume.webdavLatestBackup")
                            : item.name,
                    icon:
                        item.type === "latest"
                            ? "save-outline" as const
                            : "document-outline" as const,
                    value: item.path,
                }),
            );

            if (!candidates.length) {
                Toast.warn(t("toast.backupFileNotFound"));
                return;
            }

            if (candidates.length === 1) {
                await showWebdavResumePreview(candidates[0].value);
                return;
            }

            showPanel("SimpleSelect", {
                header: t("backupAndResume.selectWebdavBackup"),
                candidates,
                onPress(item) {
                    showWebdavResumePreview(`${item.value}`);
                },
            });
        } catch (e: any) {
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onBackupToWebdav() {
        try {
            if (!(await hasConfiguredWebdav())) {
                Toast.warn(t("toast.resumePreCheckFailed"));
                return;
            }
            await backupToWebdav();
            Toast.success(t("toast.backupSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.backupFail", { reason: e?.message ?? e }));
        }
    }

    const getWebdavAutoBackupLabel = (
        interval: IWebdavAutoBackupInterval,
    ) => t((`backupAndResume.webdavAutoBackup.${interval}`) as any);

    function onSetWebdavAutoBackupInterval() {
        const candidates: IWebdavAutoBackupInterval[] = [
            "off",
            "daily",
            "weekly",
        ];
        showDialog("RadioDialog", {
            title: t("backupAndResume.webdavAutoBackup"),
            content: candidates.map(interval => ({
                label: getWebdavAutoBackupLabel(interval),
                value: interval,
            })),
            defaultSelected: webdavAutoBackupInterval,
            onOk(value) {
                Config.setConfig(
                    "webdav.autoBackupInterval",
                    value as IWebdavAutoBackupInterval,
                );
            },
        });
    }

    function setWebdavAutoBackupWifiOnly(value: boolean) {
        Config.setConfig("webdav.autoBackupWifiOnly", value);
    }

    function getWebdavAutoBackupSkipReasonLabel() {
        switch (webdavAutoBackupLastSkipReason) {
        case "wifiOnly":
            return t(
                "backupAndResume.webdavAutoBackupStatus.skipReason.wifiOnly",
            );
        default:
            return "";
        }
    }

    function getWebdavAutoBackupStatus() {
        const lastSuccessAt = webdavAutoBackupLastSuccessAt ?? 0;
        const lastFailedAt = webdavAutoBackupLastFailedAt ?? 0;
        const lastSkippedAt = webdavAutoBackupLastSkippedAt ?? 0;

        if (
            lastFailedAt &&
            lastFailedAt >= lastSuccessAt &&
            lastFailedAt >= lastSkippedAt
        ) {
            const title = t("backupAndResume.webdavAutoBackupStatus.failed", {
                time: formatLocalTime(lastFailedAt),
            });
            const failureReason = webdavAutoBackupLastError
                ? t("backupAndResume.webdavAutoBackupStatus.failureReason", {
                    reason: webdavAutoBackupLastError,
                })
                : "";
            return {
                description: failureReason
                    ? `${title}; ${failureReason}`
                    : title,
            };
        }

        if (lastSkippedAt && lastSkippedAt >= lastSuccessAt) {
            const title = t("backupAndResume.webdavAutoBackupStatus.skipped", {
                time: formatLocalTime(lastSkippedAt),
            });
            const reason = getWebdavAutoBackupSkipReasonLabel();
            const skipReason = reason
                ? t("backupAndResume.webdavAutoBackupStatus.skipReason", {
                    reason,
                })
                : "";
            return {
                description: skipReason ? `${title}; ${skipReason}` : title,
            };
        }

        if (lastSuccessAt) {
            return {
                description: t("backupAndResume.webdavAutoBackupStatus.success", {
                    time: formatLocalTime(lastSuccessAt),
                }),
            };
        }

        return {
            description: t("backupAndResume.webdavAutoBackupStatus.never"),
        };
    }

    const webdavAutoBackupStatus = getWebdavAutoBackupStatus();

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>{t("sidebar.backupAndResume")}</ListItemHeader>

            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showDialog("RadioDialog", {
                        title: t("backupAndResume.setResumeMode"),
                        content: [
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Append) as any),
                                value: ResumeMode.Append,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.OverwriteDefault) as any),
                                value: ResumeMode.OverwriteDefault,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Overwrite) as any),
                                value: ResumeMode.Overwrite,
                            },
                        ],
                        onOk(value) {
                            Config.setConfig(
                                "backup.resumeMode",
                                value as any,
                            );
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.resumeMode")} />
                <ListItem.ListItemText>
                    {
                        t(("backupAndResume.resumeMode." + ((resumeMode as ResumeMode) ||
                            ResumeMode.Append)) as any)
                    }
                </ListItem.ListItemText>
            </ListItem>
            <ListItemHeader>{t("backupAndResume.localBackup")}</ListItemHeader>
            <ListItem withHorizontalPadding onPress={onBackupToLocal}>
                <ListItem.Content title={t("backupAndResume.backupToLocal")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromLocal}>
                <ListItem.Content title={t("backupAndResume.resumeFromLocalFile")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromUrl}>
                <ListItem.Content title={t("backupAndResume.resumeFromUrlDialogTitle")} />
            </ListItem>
            <ListItemHeader>Webdav</ListItemHeader>
            {credentialMigrationError ? (
                <ListItem
                    withHorizontalPadding
                    onPress={async () => {
                        try {
                            await retryLegacyCredentialMigration();
                            setCredentialMigrationError(null);
                            Toast.success(
                                t(
                                    "backupAndResume.credentialMigrationRetrySuccess",
                                ),
                            );
                        } catch {
                            // 旧明文和 schema 都保持不变，下次启动仍会自动重试。
                            Toast.warn(
                                t(
                                    "backupAndResume.credentialMigrationRetryFailed",
                                ),
                            );
                        }
                    }}>
                    <ListItem.Content
                        title={t("backupAndResume.credentialMigrationFailed")}
                        description={t(
                            "backupAndResume.credentialMigrationFailedDesc",
                        )}
                    />
                </ListItem>
            ) : null}
            <ListItem
                withHorizontalPadding
                onPress={async () => {
                    let hasStoredPassword = false;
                    try {
                        hasStoredPassword =
                            await SecureCredential.hasCredential(
                                webdavPasswordCredentialKey,
                            );
                    } catch (e: any) {
                        Toast.warn(e?.message ?? "Secure credential unavailable");
                        return;
                    }
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.webdavSettings"),
                        initValues: {
                            url: webdavUrl ?? "",
                            username: webdavUsername ?? "",
                            password: "",
                        },
                        variables: [
                            {
                                key: "url",
                                name: "URL",
                                hint: t("backupAndResume.webdavUrl"),
                            },
                            {
                                key: "username",
                                name: t("common.username"),
                            },
                            {
                                key: "password",
                                name: t("common.password"),
                                hint: hasStoredPassword
                                    ? t(
                                        "backupAndResume.webdavPasswordStoredHint",
                                    )
                                    : t(
                                        "backupAndResume.webdavPasswordMissingHint",
                                    ),
                                secureTextEntry: true,
                            },
                        ],
                        async onOk(values, closePanel) {
                            const transaction =
                                createWebdavSettingsTransaction(values, {
                                    currentUrl: webdavUrl,
                                    deletePassword: () =>
                                        SecureCredential.deleteCredential(
                                            webdavPasswordCredentialKey,
                                        ),
                                    hasStoredPassword,
                                    onSuccess: () => {
                                        Toast.success(t("toast.saveSuccess"));
                                        closePanel();
                                    },
                                    setConfig: (key, value) => {
                                        Config.setConfig(key, value as any);
                                    },
                                    setPassword: password =>
                                        setCredentialVerified(
                                            webdavPasswordCredentialKey,
                                            password,
                                        ),
                                });
                            if (transaction.kind === "invalid") {
                                Toast.warn(
                                    transaction.reason === "incomplete"
                                        ? t("toast.resumePreCheckFailed")
                                        : transaction.reason,
                                );
                                return;
                            }
                            const saveSettings = async () => {
                                try {
                                    await transaction.commit();
                                } catch (e: any) {
                                    Toast.warn(
                                        e?.message ??
                                        "Secure credential unavailable",
                                    );
                                }
                            };
                            if (transaction.requiresHttpConfirmation) {
                                showDialog("SimpleDialog", {
                                    title: t(
                                        "backupAndResume.webdavHttpWarningTitle",
                                    ),
                                    content: t(
                                        "backupAndResume.webdavHttpWarningContent",
                                    ),
                                    okText: t(
                                        "backupAndResume.webdavHttpWarningConfirm",
                                    ),
                                    onOk() {
                                        saveSettings();
                                    },
                                });
                                return;
                            }
                            await saveSettings();
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.webdavSettings")} />
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={onSetWebdavAutoBackupInterval}>
                <ListItem.Content
                    title={t("backupAndResume.webdavAutoBackup")}
                />
                <ListItem.ListItemText>
                    {getWebdavAutoBackupLabel(webdavAutoBackupInterval)}
                </ListItem.ListItemText>
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    setWebdavAutoBackupWifiOnly(!webdavAutoBackupWifiOnly);
                }}
                accessibilityLabel={t("backupAndResume.webdavAutoBackupWifiOnly")}
                accessibilityState={{ checked: webdavAutoBackupWifiOnly }}>
                <ListItem.Content
                    title={t("backupAndResume.webdavAutoBackupWifiOnly")}
                />
                <ThemeSwitch
                    value={webdavAutoBackupWifiOnly}
                    onValueChange={setWebdavAutoBackupWifiOnly}
                />
            </ListItem>
            <ListItem withHorizontalPadding>
                <ListItem.Content
                    title={t("backupAndResume.webdavAutoBackupStatus")}
                    description={webdavAutoBackupStatus.description}
                />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onBackupToWebdav}>
                <ListItem.Content title={t("backupAndResume.backupToWebdav")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromWebdav}>
                <ListItem.Content title={t("backupAndResume.resumeFromWebdav")} />
            </ListItem>
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
