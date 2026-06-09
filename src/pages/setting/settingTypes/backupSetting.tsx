import ListItem, { ListItemHeader } from "@/components/base/listItem";
import Backup, {
    IBackupPreview,
    IBackupResumeReport,
    IBackupResumeSectionReport,
} from "@/core/backup";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Toast from "@/utils/toast";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";

import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import axios from "axios";

import { ResumeMode } from "@/constants/commonConst.ts";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import delay from "@/utils/delay";
import { checkAndCreateDir, writeInChunks } from "@/utils/fileUtils.ts";
import { errorLog } from "@/utils/log.ts";
import { getDocumentAsync } from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import { DocumentDirectoryPath } from "react-native-fs";
import { AuthType, createClient } from "webdav";
import Clipboard from "@react-native-clipboard/clipboard";

const preRestoreBackupDir = `${DocumentDirectoryPath}/MusicFree`;
const webdavRootPath = "/MusicFree";
const webdavLatestBackupPath = `${webdavRootPath}/MusicFreeBackup.json`;
const webdavHistoryDir = `${webdavRootPath}/Backups`;
const webdavHistoryKeepCount = 10;

interface IWebdavBackupFile {
    basename?: string;
    filename?: string;
    type?: string;
}

function formatBackupTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}

async function ensureWebdavDirectory(client: ReturnType<typeof createClient>, path: string) {
    if (!(await client.exists(path))) {
        await client.createDirectory(path);
    }
}

function getWebdavBackupFileName(item: IWebdavBackupFile) {
    return item.basename ?? item.filename?.split("/").pop() ?? "";
}

function isWebdavHistoryBackupFile(item: IWebdavBackupFile) {
    return item.type !== "directory" &&
        !!item.filename &&
        getWebdavBackupFileName(item).startsWith("MusicFreeBackup-");
}

async function getWebdavHistoryBackups(client: ReturnType<typeof createClient>) {
    if (!(await client.exists(webdavHistoryDir))) {
        return [];
    }
    const contents = await client.getDirectoryContents(webdavHistoryDir) as IWebdavBackupFile[];
    return contents
        .filter(isWebdavHistoryBackupFile)
        .sort((a, b) =>
            getWebdavBackupFileName(b)
                .localeCompare(getWebdavBackupFileName(a)),
        );
}

async function pruneWebdavBackupHistory(client: ReturnType<typeof createClient>) {
    try {
        const backupFiles = await getWebdavHistoryBackups(client);

        await Promise.all(
            backupFiles
                .slice(webdavHistoryKeepCount)
                .map(item => item.filename)
                .filter((filename): filename is string => !!filename)
                .map(filename => client.deleteFile(filename)),
        );
    } catch (e) {
        errorLog("清理 WebDAV 备份历史失败", e);
    }
}

export default function BackupSetting() {
    const { t } = useI18N();
    const navigate = useNavigate();

    const resumeMode = useAppConfig("backup.resumeMode");
    const webdavUrl = useAppConfig("webdav.url");
    const webdavUsername = useAppConfig("webdav.username");
    const webdavPassword = useAppConfig("webdav.password");

    function formatResumePreview(preview: IBackupPreview) {
        return [
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
                onCancel(hideDialog) {
                    hideDialog();
                    resolve(false);
                },
                onReject(reason, hideDialog) {
                    hideDialog();
                    resolve(false);
                    console.log(reason);
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
            showDialog("SimpleDialog", {
                title: t("backupAndResume.resumePreviewTitle"),
                content: formatResumePreview(preview),
                okText: t("backupAndResume.startResume"),
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
                        onResolve(_, hideDialog) {
                            Toast.success(t("toast.backupSuccess"));
                            hideDialog();
                            resolve(true);
                        },
                        onCancel(hideDialog) {
                            hideDialog();
                            resolve(false);
                        },
                        onReject(reason, hideDialog) {
                            hideDialog();
                            resolve(false);
                            console.log(reason);
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
                        const raw = (await axios.get(text)).data;
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
        const url = Config.getConfig("webdav.url");
        const username = Config.getConfig("webdav.username");
        const password = Config.getConfig("webdav.password");

        if (!(username && password && url)) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }
        const client = createClient(url, {
            authType: AuthType.Password,
            username: username,
            password: password,
        });

        async function showWebdavResumePreview(path: string) {
            try {
                const resumeData = await client.getFileContents(
                    path,
                    {
                        format: "text",
                    },
                );
                showResumePreview(resumeData as string);
            } catch (e: any) {
                Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
            }
        }

        try {
            const candidates: Array<{
                title: string;
                icon: "save-outline" | "document-outline";
                value: string;
            }> = [];

            if (await client.exists(webdavLatestBackupPath)) {
                candidates.push({
                    title: t("backupAndResume.webdavLatestBackup"),
                    icon: "save-outline",
                    value: webdavLatestBackupPath,
                });
            }

            const historyBackups = await getWebdavHistoryBackups(client);
            historyBackups.forEach(item => {
                candidates.push({
                    title: getWebdavBackupFileName(item),
                    icon: "document-outline",
                    value: item.filename as string,
                });
            });

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
        const username = Config.getConfig("webdav.username");
        const password = Config.getConfig("webdav.password");
        const url = Config.getConfig("webdav.url");
        if (!(username && password && url)) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }
        try {
            const client = createClient(url, {
                authType: AuthType.Password,
                username: username,
                password: password,
            });

            const raw = Backup.backup();
            await ensureWebdavDirectory(client, webdavRootPath);
            await ensureWebdavDirectory(client, webdavHistoryDir);

            const historyBackupPath =
                `${webdavHistoryDir}/MusicFreeBackup-${formatBackupTimestamp()}.json`;
            await client.putFileContents(
                historyBackupPath,
                raw,
                {
                    overwrite: false,
                },
            );
            await client.putFileContents(
                webdavLatestBackupPath,
                raw,
                {
                    overwrite: true,
                },
            );
            await pruneWebdavBackupHistory(client);
            Toast.success(t("toast.backupSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.backupFail", { reason: e?.message ?? e }));
        }
    }

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
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.webdavSettings"),
                        initValues: {
                            url: webdavUrl ?? "",
                            username: webdavUsername ?? "",
                            password: webdavPassword ?? "",
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
                            },
                        ],
                        onOk(values, closePanel) {
                            Config.setConfig("webdav.url", values?.url);
                            Config.setConfig("webdav.username", values?.username);
                            Config.setConfig("webdav.password", values?.password);

                            Toast.success(t("toast.saveSuccess"));
                            closePanel();
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.webdavSettings")} />
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
