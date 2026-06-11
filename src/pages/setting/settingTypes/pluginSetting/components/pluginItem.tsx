import React, { memo } from "react";

import useColors from "@/hooks/useColors";
import pluginManager, { Plugin, usePluginEnabled } from "@/core/pluginManager";

import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import * as DocumentPicker from "expo-document-picker";
import { useNavigation } from "@react-navigation/native";
import Config from "@/core/appConfig";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import rpx from "@/utils/rpx";
import { Pressable, StyleSheet, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import IconTextButton from "@/components/base/iconTextButton";
import ThemeSwitch from "@/components/base/switch";
import { IIconName } from "@/components/base/icon.tsx";
import { useI18N } from "@/core/i18n";
import IconButton from "@/components/base/iconButton";
import useRerender from "@/hooks/useRerender";
import {
    getLatestPluginDiagnosticEvent,
    getPluginDiagnosticEvents,
} from "@/core/pluginManager/diagnostics";
import type { PluginDiagnosticEvent } from "@/core/pluginManager/diagnostics";
import {
    getPluginCapabilityLabels,
    getPluginSourceInfo,
    type IPluginSettingTranslate,
    pluginCapabilityConfigs,
    pluginSupportsCapability,
} from "../capabilityUtils";
import { buildPluginHealthCheckReport } from "../healthCheckUtils";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import {
    writePluginHealthCheckReport,
    writePluginTestSearchReport,
} from "../reportExportUtils";
import { showPluginInstallResults } from "../installPluginUtils";

interface IPluginItemProps {
    plugin: Plugin;
}

interface IOption {
    title: string;
    icon: IIconName;
    onPress?: () => void;
    show?: boolean;
}

function getPluginTestSearchType(plugin: Plugin): ICommon.SupportMediaType {
    const supportedTypes = plugin.instance.supportedSearchType;
    const defaultType = plugin.instance.defaultSearchType;
    if (defaultType && (!supportedTypes || supportedTypes.includes(defaultType))) {
        return defaultType;
    }
    return supportedTypes?.[0] ?? "music";
}

function getPluginTestSearchTypes(plugin: Plugin): ICommon.SupportMediaType[] {
    const supportedTypes = plugin.instance.supportedSearchType ?? [];
    const defaultType = getPluginTestSearchType(plugin);
    return Array.from(new Set([defaultType, ...supportedTypes]));
}

function getSearchTypeIcon(type: ICommon.SupportMediaType): IIconName {
    switch (type) {
        case "album":
            return "album-outline";
        case "artist":
            return "user";
        case "sheet":
            return "playlist";
        case "lyric":
            return "lyric";
        case "music":
        default:
            return "musical-note";
    }
}

function formatTestSearchResultItem(item: any) {
    return [
        item?.title,
        item?.artist,
        item?.album,
        item?.author,
        item?.platform,
    ].filter(Boolean).join(" - ") || "-";
}

function sanitizeTestSearchFailureReason(reason: unknown) {
    const raw = String(reason ?? "-")
        .replace(/([?&](?:access_token|refresh_token|token|auth|authorization|cookie|session|password|passwd|secret|sign)=)[^&\s]+/gi, "$1<redacted>")
        .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1<redacted>")
        .replace(/(cookie\s*[:=]\s*)[^\s;]+/gi, "$1<redacted>")
        .replace(/[a-z]:\\[^\s'",)]+/gi, "<local-path>")
        .replace(/\s+/g, " ")
        .trim();
    if (!raw) {
        return "-";
    }
    return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
}

function formatSingleLine(value: unknown, maxLength = 120) {
    const text = String(value ?? "-").replace(/\s+/g, " ").trim();
    if (!text) {
        return "-";
    }
    return text.length > maxLength
        ? `${text.slice(0, maxLength)}...`
        : text;
}

function formatDiagnosticRelativeTime(
    timestamp: number,
    t: IPluginSettingTranslate,
) {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) {
        return t("pluginSetting.pluginItem.diagnosticTime.now");
    }
    if (diff < 3_600_000) {
        return t("pluginSetting.pluginItem.diagnosticTime.minutes", {
            count: Math.max(1, Math.floor(diff / 60_000)),
        });
    }
    if (diff < 86_400_000) {
        return t("pluginSetting.pluginItem.diagnosticTime.hours", {
            count: Math.max(1, Math.floor(diff / 3_600_000)),
        });
    }
    if (diff < 604_800_000) {
        return t("pluginSetting.pluginItem.diagnosticTime.days", {
            count: Math.max(1, Math.floor(diff / 86_400_000)),
        });
    }
    return new Date(timestamp).toLocaleDateString();
}

function getUserVariableLabel(variable: IPlugin.IUserVariable) {
    return variable.name
        ? `${variable.name} (${variable.key})`
        : variable.key;
}

function getConfiguredUserVariableCount(
    declaredVariables: IPlugin.IUserVariable[],
    userVariables: Record<string, string>,
) {
    return declaredVariables.filter(variable =>
        String(userVariables[variable.key] ?? "").trim(),
    ).length;
}

function getMissingUserVariableLabels(
    declaredVariables: IPlugin.IUserVariable[],
    userVariables: Record<string, string>,
) {
    return declaredVariables
        .filter(variable => !String(userVariables[variable.key] ?? "").trim())
        .map(getUserVariableLabel);
}

function _PluginItem(props: IPluginItemProps) {
    const { plugin } = props;
    const colors = useColors();
    const enabled = usePluginEnabled(plugin);
    const { t } = useI18N();
    const rerender = useRerender();
    const navigate = useNavigate();
    const navigator = useNavigation<any>();

    const alternativePluginName = pluginManager.getAlternativePluginName(plugin);
    const sourceInfo = getPluginSourceInfo(plugin, t);
    const capabilityLabels = getPluginCapabilityLabels(plugin, t);
    const visibleCapabilityLabels = capabilityLabels.slice(0, 6);
    const hiddenCapabilityCount =
        capabilityLabels.length - visibleCapabilityLabels.length;
    const declaredUserVariables = Array.isArray(plugin.instance.userVariables)
        ? plugin.instance.userVariables
        : [];
    const userVariables = pluginManager.getUserVariables(plugin);
    const configuredUserVariableCount = getConfiguredUserVariableCount(
        declaredUserVariables,
        userVariables,
    );
    const missingUserVariableLabels = getMissingUserVariableLabels(
        declaredUserVariables,
        userVariables,
    );
    const userVariableSummary = declaredUserVariables.length
        ? missingUserVariableLabels.length
            ? t("pluginSetting.pluginItem.userVariablesMissingSummary", {
                count: missingUserVariableLabels.length,
                names: formatSingleLine(
                    missingUserVariableLabels.join(", "),
                    80,
                ),
            })
            : t("pluginSetting.pluginItem.userVariablesConfiguredSummary", {
                configured: configuredUserVariableCount,
                total: declaredUserVariables.length,
            })
        : null;
    const latestDiagnostic = getLatestPluginDiagnosticEvent(
        plugin.hash,
        plugin.name,
    );
    const diagnosticSummary = latestDiagnostic
        ? t("pluginSetting.pluginItem.recentDiagnostic", {
            method: latestDiagnostic.method,
            time: formatDiagnosticRelativeTime(latestDiagnostic.createdAt, t),
            message: formatSingleLine(latestDiagnostic.message, 80),
        })
        : t("pluginSetting.pluginItem.noRecentDiagnostic");

    function getSearchTypeLabel(type: ICommon.SupportMediaType) {
        switch (type) {
            case "album":
                return t("common.album");
            case "artist":
                return t("common.artist");
            case "sheet":
                return t("common.sheet");
            case "lyric":
                return t("home.sourceCapability.lyric");
            case "music":
            default:
                return t("common.singleMusic");
        }
    }

    function exportTestSearchReport(reportText: string) {
        setTimeout(() => {
            navigate(ROUTE_PATH.FILE_SELECTOR, {
                fileType: "folder",
                multi: false,
                actionText: t("pluginSetting.testSearch.exportReportAction"),
                async onAction(selectedFiles) {
                    const folder = selectedFiles[0]?.path;
                    if (!folder) {
                        return false;
                    }
                    try {
                        const filename = await writePluginTestSearchReport(
                            folder,
                            reportText,
                        );
                        Toast.success(t(
                            "pluginSetting.testSearch.exportReportSuccess",
                            { filename },
                        ));
                        return true;
                    } catch (e: any) {
                        Toast.warn(t(
                            "pluginSetting.testSearch.exportReportFailed",
                            { reason: e?.message ?? e },
                        ));
                        return false;
                    }
                },
            });
        }, 0);
    }

    function exportHealthCheckReport(reportText: string) {
        setTimeout(() => {
            navigate(ROUTE_PATH.FILE_SELECTOR, {
                fileType: "folder",
                multi: false,
                actionText: t("pluginSetting.healthCheck.exportReportAction"),
                async onAction(selectedFiles) {
                    const folder = selectedFiles[0]?.path;
                    if (!folder) {
                        return false;
                    }
                    try {
                        const filename = await writePluginHealthCheckReport(
                            folder,
                            reportText,
                        );
                        Toast.success(t(
                            "pluginSetting.healthCheck.exportReportSuccess",
                            { filename },
                        ));
                        return true;
                    } catch (e: any) {
                        Toast.warn(t(
                            "pluginSetting.healthCheck.exportReportFailed",
                            { reason: e?.message ?? e },
                        ));
                        return false;
                    }
                },
            });
        }, 0);
    }

    function buildCurrentHealthCheckReport(diagnosticsLimit = 3) {
        return buildPluginHealthCheckReport({
            plugin,
            enabled,
            sourceLabel: sourceInfo.label,
            sourceKnown: !!(plugin.instance.srcUrl || plugin.path),
            capabilityLabels,
            userVariables: pluginManager.getUserVariables(plugin),
            diagnostics: getPluginDiagnosticEvents(
                plugin.hash,
                plugin.name,
                diagnosticsLimit,
            ),
            t,
        });
    }

    function buildCombinedTestSearchReport(searchReport: string) {
        const healthCheckReport = buildCurrentHealthCheckReport();
        return [
            t("pluginSetting.testSearch.combinedReportTitle", {
                name: plugin.name,
            }),
            "",
            `${t("pluginSetting.testSearch.generatedAt")}: ${new Date().toLocaleString()}`,
            "",
            `## ${t("pluginSetting.testSearch.searchSection")}`,
            searchReport,
            "",
            `## ${t("pluginSetting.testSearch.healthCheckSection")}`,
            healthCheckReport.reportText,
        ].join("\n");
    }

    function showTestSearchResult(
        keyword: string,
        type: ICommon.SupportMediaType,
        result: IPlugin.ISearchResult<ICommon.SupportMediaType>,
    ) {
        const resultLines = result.data?.slice(0, 5).map((item, index) =>
            `${index + 1}. ${formatTestSearchResultItem(item)}`,
        ) ?? [];
        const title = t("pluginSetting.testSearch.resultTitle", {
            name: plugin.name,
        });
        const content = [
            t("pluginSetting.testSearch.resultSummary", {
                keyword,
                type,
                count: result.data?.length ?? 0,
                isEnd: result.isEnd
                    ? t("pluginSetting.testSearch.isEnd.yes")
                    : t("pluginSetting.testSearch.isEnd.no"),
            }),
            resultLines.length
                ? resultLines.join("\n")
                : t("pluginSetting.testSearch.noResults"),
        ].join("\n\n");
        const reportText = buildCombinedTestSearchReport(
            [title, "", content].join("\n"),
        );
        showDialog("SimpleDialog", {
            title,
            content,
            okText: t("pluginSetting.testSearch.copyCombinedReport"),
            cancelText: t("pluginSetting.testSearch.exportReport"),
            onCancel() {
                exportTestSearchReport(reportText);
            },
            onOk() {
                Clipboard.setString(reportText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    function showTestSearchFailure(
        keyword: string,
        type: ICommon.SupportMediaType,
        reason: any,
        diagnostic?: PluginDiagnosticEvent,
    ) {
        const reasonText = diagnostic?.message ??
            sanitizeTestSearchFailureReason(reason?.message ?? reason);
        const title = t("pluginSetting.testSearch.failureTitle", {
            name: plugin.name,
        });
        const diagnosticLines = diagnostic
            ? [
                `${t("pluginSetting.testSearch.failureDiagnosticMethod")}: ${diagnostic.method}`,
                `${t("pluginSetting.testSearch.failureDiagnosticTime")}: ${new Date(diagnostic.createdAt).toLocaleString()}`,
                diagnostic.estimatedLocation
                    ? `${t("pluginSetting.testSearch.failureDiagnosticLocation")}: ${diagnostic.estimatedLocation}`
                    : "",
            ].filter(Boolean)
            : [t("pluginSetting.testSearch.failureNoDiagnostic")];
        const content = [
            t("pluginSetting.testSearch.failureSummary", {
                keyword,
                type,
                reason: reasonText,
            }),
            "",
            t("pluginSetting.testSearch.failureDiagnosticTitle"),
            ...diagnosticLines,
        ].join("\n");
        const reportText = buildCombinedTestSearchReport(
            [title, "", content].join("\n"),
        );
        showDialog("SimpleDialog", {
            title,
            content,
            okText: t("pluginSetting.testSearch.copyCombinedReport"),
            cancelText: t("pluginSetting.testSearch.exportReport"),
            onCancel() {
                exportTestSearchReport(reportText);
            },
            onOk() {
                Clipboard.setString(reportText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
        Toast.warn(t("pluginSetting.testSearch.failed", {
            reason: reasonText,
        }));
    }

    function showTestSearchInput(searchType: ICommon.SupportMediaType) {
        showPanel("SimpleInput", {
            title: t("pluginSetting.pluginItem.options.testSearch"),
            placeholder: t(
                "pluginSetting.pluginItem.options.testSearchPlaceHolder",
            ),
            maxLength: 80,
            async onOk(text, closePanel) {
                const keyword = text.trim();
                if (!keyword) {
                    Toast.warn(t("pluginSetting.testSearch.emptyKeyword"));
                    return;
                }
                closePanel();
                setTimeout(() => {
                    const testStartedAt = Date.now();
                    showDialog("LoadingDialog", {
                        title: t("pluginSetting.pluginItem.options.testSearch"),
                        loadingText: t("pluginSetting.testSearch.loading"),
                        task() {
                            return plugin.methods.search(
                                keyword,
                                1,
                                searchType,
                            );
                        },
                        onResolve(result, hideDialog) {
                            hideDialog();
                            showTestSearchResult(
                                keyword,
                                searchType,
                                result as IPlugin.ISearchResult<ICommon.SupportMediaType>,
                            );
                        },
                        onReject(reason, hideDialog) {
                            hideDialog();
                            const latestDiagnostic = getPluginDiagnosticEvents(
                                plugin.hash,
                                plugin.name,
                                5,
                            ).find(event =>
                                event.method === "search" &&
                                event.createdAt >= testStartedAt - 1000,
                            );
                            showTestSearchFailure(
                                keyword,
                                searchType,
                                reason,
                                latestDiagnostic,
                            );
                        },
                    });
                }, 0);
            },
        });
    }

    function onTestSearch() {
        const searchTypes = getPluginTestSearchTypes(plugin);
        if (searchTypes.length <= 1) {
            showTestSearchInput(searchTypes[0] ?? "music");
            return;
        }

        showPanel("SimpleSelect", {
            header: t("pluginSetting.testSearch.selectType"),
            candidates: searchTypes.map(searchType => ({
                title: getSearchTypeLabel(searchType),
                value: searchType,
                icon: getSearchTypeIcon(searchType),
            })),
            onPress(item) {
                setTimeout(() => {
                    showTestSearchInput(item.value as ICommon.SupportMediaType);
                }, 0);
            },
        });
    }

    function onHealthCheck() {
        const report = buildCurrentHealthCheckReport();

        showDialog("SimpleDialog", {
            title: report.title,
            content: report.content,
            okText: t("pluginSetting.healthCheck.copyReport"),
            cancelText: t("pluginSetting.healthCheck.exportReport"),
            onCancel() {
                exportHealthCheckReport(report.reportText);
            },
            onOk() {
                Clipboard.setString(report.reportText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    function openUserVariablesPanel() {
        if (!declaredUserVariables.length) {
            return;
        }
        showPanel("SetUserVariables", {
            async onOk(newValue, closePanel) {
                pluginManager.setUserVariables(plugin, newValue);
                Toast.success(t("toast.settingSuccess"));
                rerender();
                closePanel();
            },
            variables: declaredUserVariables,
            initValues: pluginManager.getUserVariables(plugin),
        });
    }

    async function onReselectLocalPluginFile() {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                multiple: false,
                type: [
                    "application/javascript",
                    "application/x-javascript",
                    "text/javascript",
                    "text/plain",
                    "application/octet-stream",
                    "*/*",
                ],
            });
            if (result.canceled) {
                return;
            }

            const asset = result.assets[0];
            if (!asset?.uri) {
                return;
            }

            const installResult = await pluginManager.installPluginFromLocalFile(
                asset.uri,
                {
                    expectedPluginName: plugin.name,
                    notCheckVersion: Config.getConfig(
                        "basic.notCheckPluginVersion",
                    ),
                    useExpoFs: true,
                },
            );
            const displayResult = {
                ...installResult,
                pluginUrl: installResult.pluginUrl ?? asset.name ?? asset.uri,
                sourceType: installResult.sourceType ?? "local-file",
            };
            showPluginInstallResults(
                displayResult.success ? [displayResult] : [],
                displayResult.success ? [] : [displayResult],
                t,
            );
            if (displayResult.success) {
                rerender();
            }
        } catch (e: any) {
            Toast.warn(t("toast.installPluginFail", {
                reason: e?.message ?? "",
            }));
        }
    }

    const options: IOption[] = [
        {
            title: t("pluginSetting.pluginItem.options.viewDetails"),
            icon: "information-circle",
            onPress() {
                const diagnostics = getPluginDiagnosticEvents(
                    plugin.hash,
                    plugin.name,
                    5,
                );
                const supportedCapabilityLabels = pluginCapabilityConfigs
                    .filter(config => pluginSupportsCapability(plugin, config))
                    .map(config => t(config.labelKey));
                const unsupportedCapabilityLabels = pluginCapabilityConfigs
                    .filter(config => !pluginSupportsCapability(plugin, config))
                    .map(config => t(config.labelKey));
                const detailContent = [
                    `${t("pluginSetting.pluginItem.detail.status")}: ${enabled
                        ? t("pluginSetting.pluginItem.detail.enabled")
                        : t("pluginSetting.pluginItem.detail.disabled")}`,
                    `${t("pluginSetting.pluginItem.detail.version")}: ${plugin.instance.version ?? "-"}`,
                    `${t("pluginSetting.pluginItem.detail.author")}: ${plugin.instance.author ?? "-"}`,
                    `${t("pluginSetting.pluginItem.detail.platform")}: ${plugin.instance.platform ?? plugin.name}`,
                    `${t("pluginSetting.pluginItem.detail.source")}: ${sourceInfo.label}`,
                    sourceInfo.detail
                        ? `${t("pluginSetting.pluginItem.detail.sourceDetail")}: ${sourceInfo.detail}`
                        : "",
                    `${t("pluginSetting.pluginItem.detail.hash")}: ${plugin.hash}`,
                    "",
                    `${t("pluginSetting.pluginItem.detail.supportedCapabilities")}:`,
                    supportedCapabilityLabels.length
                        ? supportedCapabilityLabels.map(label => `- ${label}`).join("\n")
                        : t("pluginSetting.pluginItem.detail.noCapabilities"),
                    "",
                    `${t("pluginSetting.pluginItem.detail.unsupportedCapabilities")}:`,
                    unsupportedCapabilityLabels.length
                        ? unsupportedCapabilityLabels.map(label => `- ${label}`).join("\n")
                        : t("pluginSetting.pluginItem.detail.noUnsupportedCapabilities"),
                    "",
                    `${t("pluginSetting.pluginItem.detail.config")}:`,
                    declaredUserVariables.length
                        ? `${t("pluginSetting.pluginItem.detail.userVariables")}: ${t("pluginSetting.pluginItem.detail.userVariablesSummary", {
                            configured: configuredUserVariableCount,
                            total: declaredUserVariables.length,
                        })}`
                        : `${t("pluginSetting.pluginItem.detail.userVariables")}: ${t("pluginSetting.pluginItem.detail.userVariablesNone")}`,
                    missingUserVariableLabels.length
                        ? `${t("pluginSetting.pluginItem.detail.userVariablesMissing")}: ${missingUserVariableLabels.join(", ")}`
                        : "",
                    `${t("pluginSetting.pluginItem.detail.alternativePlugin")}: ${alternativePluginName ?? t("pluginSetting.pluginItem.detail.noAlternativePlugin")}`,
                    "",
                    `${t("pluginSetting.pluginItem.detail.diagnostics")}:`,
                    diagnostics.length
                        ? diagnostics.map(event => {
                            const time = new Date(
                                event.createdAt,
                            ).toLocaleString();
                            return [
                                `- ${time} ${event.method}`,
                                `  ${event.message}`,
                                event.estimatedLocation
                                    ? `  ${event.estimatedLocation}`
                                    : "",
                            ]
                                .filter(Boolean)
                                .join("\n");
                        }).join("\n")
                        : t("pluginSetting.pluginItem.detail.noDiagnostics"),
                ]
                    .filter(Boolean)
                    .join("\n");
                showDialog("SimpleDialog", {
                    title: plugin.name,
                    content: detailContent,
                    okText: t("pluginSetting.pluginItem.detail.copyDetails"),
                    cancelText: t("pluginSetting.pluginItem.detail.closeDetails"),
                    onOk() {
                        Clipboard.setString(detailContent);
                        Toast.success(t("toast.copiedToClipboard"));
                    },
                });
            },
            show: true,
        },
        {
            title: t("pluginSetting.pluginItem.options.healthCheck"),
            icon: "shield-keyhole-outline",
            onPress: onHealthCheck,
            show: true,
        },
        {
            title: t("pluginSetting.pluginItem.options.viewDiagnostics"),
            icon: "exclamation-circle",
            onPress() {
                navigator.navigate("/pluginsetting/diagnostics", {
                    initialPluginName: plugin.name,
                });
            },
            show: true,
        },
        {
            title: t("pluginSetting.pluginItem.options.reselectLocalFile"),
            icon: "arrow-up-tray",
            onPress: onReselectLocalPluginFile,
            show: Boolean(plugin.path && !plugin.instance.srcUrl),
        },
        {
            title: t("pluginSetting.pluginItem.options.updatePlugin"),
            icon: "arrow-path",
            async onPress() {
                try {
                    await pluginManager.updatePlugin(plugin);
                    Toast.success(t("toast.pluginUpdateSuccess"));
                } catch (e: any) {
                    Toast.warn(e?.message ?? t("toast.failToUpdatePlugin"));
                }
            },
            show: !!plugin.instance.srcUrl,
        },
        {
            title: t("pluginSetting.pluginItem.options.testSearch"),
            icon: "magnifying-glass",
            onPress: onTestSearch,
            show: !!plugin.supportedMethods.has("search"),
        },
        {
            title: t("pluginSetting.pluginItem.options.sharePlugin"),
            icon: "share",
            async onPress() {
                try {
                    Clipboard.setString(plugin.instance.srcUrl!);
                    Toast.success(t("toast.copiedToClipboard"));
                } catch (e: any) {
                    Toast.warn(e?.message ?? t("toast.failToSharePlugin"));
                }
            },
            show: !!plugin.instance.srcUrl,
        },
        {
            title: t("pluginSetting.pluginItem.options.uninstallPlugin"),
            icon: "trash-outline",
            show: true,
            onPress() {
                showDialog("SimpleDialog", {
                    title: t("pluginSetting.pluginItem.options.uninstallPlugin"),
                    content: t("pluginSetting.pluginItem.options.uninstallPluginContent", {
                        name: plugin.name,
                    }),
                    async onOk() {
                        try {
                            await pluginManager.uninstallPlugin(plugin.hash);
                            Toast.success(t("toast.pluginUninstalled"));
                        } catch {
                            Toast.warn(t("toast.failToUpdatePlugin"));
                        }
                    },
                });
            },
        },
        {
            title: t("pluginSetting.pluginItem.options.alternativePlugin"),
            icon: "strategy",
            show: true,
            onPress() {
                showDialog("RadioDialog", {
                    content: (pluginManager.getSortedPluginsWithAbility("getMediaSource").map(it => it.name)),
                    title: t("pluginSetting.pluginItem.dialog.setAlternativePluginTitle"),
                    defaultSelected: pluginManager.getAlternativePluginName(plugin) as any,
                    onOk(value) {
                        if (value === plugin.name) {
                            pluginManager.setAlternativePluginName(plugin, null as any);
                        } else {
                            pluginManager.setAlternativePluginName(plugin, value as any);
                        }
                        rerender();
                    },
                    tip: t("pluginSetting.pluginItem.dialog.setAlternativePluginTip"),

                });

            },
        },
        {
            title: t("pluginSetting.pluginItem.options.importMusic"),
            icon: "arrow-right-end-on-rectangle",
            onPress() {
                showPanel("SimpleInput", {
                    title: t("pluginSetting.pluginItem.options.importMusic"),
                    placeholder: t("pluginSetting.pluginItem.options.importMusicPlaceHolder"),
                    hints: plugin.instance.hints?.importMusicItem,
                    maxLength: 1000,
                    async onOk(text) {
                        const result = await plugin.methods.importMusicItem(
                            text,
                        );
                        if (result) {
                            showDialog("SimpleDialog", {
                                title: t("pluginSetting.pluginItem.options.importDialogTitle"),
                                content: t("pluginSetting.pluginItem.options.importMusicDialogContent", {
                                    name: result.title,
                                }),
                                onOk() {
                                    showPanel("AddToMusicSheet", {
                                        musicItem: result,
                                        newSheetDefaultName: t("pluginSetting.pluginItem.options.importMusicToSheetName", {
                                            name: plugin.name,
                                        }),
                                    });
                                },
                            });
                        } else {
                            Toast.warn(t("toast.failToImportMusic"));
                        }
                    },
                });
            },
            show: !!plugin.supportedMethods.has("importMusicItem"),
        },
        {
            title: t("pluginSetting.pluginItem.options.importSheet"),
            icon: "arrow-right-end-on-rectangle",
            onPress() {
                showPanel("SimpleInput", {
                    title: t("pluginSetting.pluginItem.options.importSheet"),
                    placeholder: t("pluginSetting.pluginItem.options.importSheetPlaceHolder"),
                    hints: plugin.instance.hints?.importMusicSheet,
                    maxLength: 1000,
                    async onOk(text, closePanel) {
                        Toast.success(t("toast.importing"));
                        closePanel();
                        const result = await plugin.methods.importMusicSheet(
                            text,
                        );
                        if (result && result.length > 0) {
                            showDialog("SimpleDialog", {
                                title: t("pluginSetting.pluginItem.options.importDialogTitle"),
                                content: t("pluginSetting.pluginItem.options.importSheetDialogContent", {
                                    count: result.length,
                                }),
                                onOk() {
                                    showPanel("AddToMusicSheet", {
                                        musicItem: result,
                                    });
                                },
                            });
                        } else {
                            Toast.warn(t("toast.failToImportSheet"));
                        }
                    },
                });
            },
            show: !!plugin.supportedMethods.has("importMusicSheet"),
        },
        {
            title: t("pluginSetting.pluginItem.options.userVariables"),
            icon: "code-bracket-square",
            onPress: openUserVariablesPanel,
            show: declaredUserVariables.length > 0,
        },
    ];

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: colors.card,
                },
            ]}>
            <View style={styles.header}>
                <View style={styles.headerPluginContainer}>
                    <ThemeText
                        numberOfLines={1}
                        fontSize="title">
                        {plugin.name}
                    </ThemeText>
                    {
                        plugin.instance.description?.length ? <IconButton name='question-mark-circle' sizeType='light' onPress={() => {
                            showDialog("MarkdownDialog", {
                                title: plugin.name,
                                markdownContent: plugin.instance.description!,
                            });
                        }} /> : null
                    }

                </View>
                <ThemeSwitch
                    value={enabled}
                    onValueChange={val => {
                        pluginManager.setPluginEnabled(plugin, val);
                    }}
                />
            </View>
            <View style={styles.description}>
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {t("pluginSetting.pluginItem.versionHint", {
                        version: plugin.instance.version,
                    })}
                </ThemeText>
                {plugin.instance.author ? (
                    <ThemeText
                        fontSize="subTitle"
                        fontColor="textSecondary"
                        numberOfLines={1}
                        style={styles.author}>
                        {t("pluginSetting.pluginItem.author", {
                            author: plugin.instance.author,
                        })}
                    </ThemeText>
                ) : null}
            </View>
            {alternativePluginName ? <View style={styles.alternativePluginDescription}>
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {t("pluginSetting.pluginItem.alternativePlugin", {
                        name: alternativePluginName,
                    })}
                </ThemeText>
            </View> : null}
            <View style={styles.tags}>
                <PluginTag>{sourceInfo.label}</PluginTag>
                {visibleCapabilityLabels.map(label => (
                    <PluginTag key={label}>{label}</PluginTag>
                ))}
                {hiddenCapabilityCount > 0 ? (
                    <PluginTag>{`+${hiddenCapabilityCount}`}</PluginTag>
                ) : null}
            </View>
            {userVariableSummary ? (
                <Pressable
                    style={styles.configSummary}
                    onPress={openUserVariablesPanel}>
                    <ThemeText
                        fontSize="description"
                        fontColor={
                            missingUserVariableLabels.length
                                ? "text"
                                : "textSecondary"
                        }
                        numberOfLines={2}>
                        {userVariableSummary}
                    </ThemeText>
                </Pressable>
            ) : null}
            <Pressable
                style={styles.diagnosticSummary}
                onPress={() => {
                    navigator.navigate("/pluginsetting/diagnostics", {
                        initialPluginName: plugin.name,
                    });
                }}>
                <ThemeText
                    fontSize="description"
                    fontColor={
                        latestDiagnostic ? "text" : "textSecondary"
                    }
                    numberOfLines={2}>
                    {diagnosticSummary}
                </ThemeText>
            </Pressable>
            <View style={styles.contents}>
                {options.map((it, index) =>
                    it.show !== false ? (
                        <IconTextButton
                            key={index}
                            icon={it.icon}
                            onPress={it.onPress}>
                            {it.title}
                        </IconTextButton>
                    ) : null,
                )}
            </View>
        </View>
        // <List.Accordion
        //     theme={{
        //         colors: {
        //             primary: colors.textHighlight,
        //         },
        //     }}
        //     style={{
        //         height: ITEM_HEIGHT_BIG,
        //     }}
        //     titleStyle={[
        //         {
        //             fontSize: fontSizeConst.title,
        //             fontWeight: fontWeightConst.semibold,
        //         },
        //         plugin.state === 'error' ? {color: 'red'} : undefined,
        //     ]}
        //     key={`plg-${plugin.hash}`}
        //     title={`${plugin.name}${
        //         plugin.instance.version ? `(${plugin.instance.version})` : ''
        //     }`}
        //     description={
        //         plugin.stateCode === PluginStateCode.VersionNotMatch
        //             ? '插件和app版本不兼容'
        //             : plugin.stateCode === PluginStateCode.CannotParse
        //             ? '无法解析插件'
        //             : undefined
        //     }>
        //     {options.map(_ =>
        //         _.show ? (
        //             <ListItem
        //                 withHorizontalPadding
        //                 key={`${plugin.hash}${_.title}`}
        //                 onPress={_.onPress}>
        //                 <ListItem.ListItemIcon icon={_.icon} />
        //                 <ListItem.Content title={_.title} />
        //             </ListItem>
        //         ) : null,
        //     )}
        // </List.Accordion>
    );
}

const PluginItem = memo(_PluginItem, (prev, curr) => {
    return prev.plugin === curr.plugin;
});
export default PluginItem;

function PluginTag(props: { children: string }) {
    const colors = useColors();
    return (
        <View
            style={[
                styles.tag,
                {
                    backgroundColor: colors.placeholder,
                },
            ]}>
            <ThemeText
                fontSize="description"
                fontColor="textSecondary"
                numberOfLines={1}>
                {props.children}
            </ThemeText>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        borderRadius: rpx(8),
        marginHorizontal: rpx(24),
        paddingVertical: rpx(18),
        marginTop: rpx(36),
    },
    header: {
        paddingHorizontal: rpx(16),
        flexDirection: "row",
        alignItems: "center",
    },
    headerPluginContainer: {
        flexShrink: 1,
        flexGrow: 1,
        flexDirection: "row",
        gap: rpx(8),
        alignItems: "center",
    },
    author: {
        marginLeft: rpx(24),
        flexShrink: 1,
        flexGrow: 1,
    },
    description: {
        marginHorizontal: rpx(16),
        marginVertical: rpx(24),
        flexDirection: "row",
    },
    alternativePluginDescription: {
        marginHorizontal: rpx(16),
        marginBottom: rpx(24),
        flexDirection: "row",
    },
    tags: {
        marginHorizontal: rpx(16),
        marginBottom: rpx(24),
        flexDirection: "row",
        flexWrap: "wrap",
        gap: rpx(10),
    },
    diagnosticSummary: {
        marginHorizontal: rpx(16),
        marginBottom: rpx(24),
    },
    configSummary: {
        marginHorizontal: rpx(16),
        marginBottom: rpx(12),
    },
    tag: {
        maxWidth: rpx(160),
        height: rpx(44),
        borderRadius: rpx(22),
        paddingHorizontal: rpx(14),
        alignItems: "center",
        justifyContent: "center",
    },
    contents: {
        flexDirection: "row",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: rpx(16),
    },
});
