import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
import Loading from "@/components/base/loading";

import PluginManager, { Plugin, useSortedPlugins } from "@/core/pluginManager";
import { trace } from "@/utils/log";

import Toast from "@/utils/toast";
import { useNavigation, useRoute } from "@react-navigation/native";
import Config from "@/core/appConfig";
import Empty from "@/components/base/empty";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import AppBar from "@/components/base/appBar";
import Fab from "@/components/base/fab";
import PluginItem from "../components/pluginItem";
import { IIconName } from "@/components/base/icon.tsx";
import { IInstallPluginResult } from "@/types/core/pluginManager";
import { useI18N } from "@/core/i18n";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Clipboard from "@react-native-clipboard/clipboard";
import {
    buildPluginDiagnosticReport,
    getLatestPluginDiagnosticEvent,
} from "@/core/pluginManager/diagnostics";
import {
    formatPluginInstallResult,
    installPluginFromUrlText,
    showPluginInstallResults,
} from "../installPluginUtils";
import { writePluginDiagnosticReport } from "../reportExportUtils";
import {
    pluginCapabilityConfigs,
    pluginSupportsCapability,
} from "../capabilityUtils";
import useColors from "@/hooks/useColors";

interface IOption {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

type PluginSourceFilter = "all" | "network" | "local-file" | "unknown";
type PluginCapabilityFilter = "all" | string;
type PluginConfigFilter = "all" | "needs-config" | "configured" | "no-config";
type PluginEnabledFilter = "all" | "enabled" | "disabled";
type PluginDiagnosticFilter =
    | "all"
    | "has-recent-error"
    | "no-recent-error";

function getPluginSourceFilterValue(
    plugin: Plugin,
): Exclude<PluginSourceFilter, "all"> {
    if (plugin.instance.srcUrl) {
        return "network";
    }
    if (plugin.path) {
        return "local-file";
    }
    return "unknown";
}

function getPluginConfigFilterValue(
    plugin: Plugin,
): Exclude<PluginConfigFilter, "all"> {
    const declaredVariables = Array.isArray(plugin.instance.userVariables)
        ? plugin.instance.userVariables
        : [];
    if (!declaredVariables.length) {
        return "no-config";
    }
    const userVariables = PluginManager.getUserVariables(plugin);
    const hasMissingVariable = declaredVariables.some(variable =>
        !String(userVariables[variable.key] ?? "").trim(),
    );
    return hasMissingVariable ? "needs-config" : "configured";
}

function getPluginEnabledFilterValue(
    plugin: Plugin,
): Exclude<PluginEnabledFilter, "all"> {
    return PluginManager.isPluginEnabled(plugin) ? "enabled" : "disabled";
}

function getPluginDiagnosticFilterValue(
    plugin: Plugin,
): Exclude<PluginDiagnosticFilter, "all"> {
    return getLatestPluginDiagnosticEvent(plugin.hash, plugin.name)
        ? "has-recent-error"
        : "no-recent-error";
}

export default function PluginList() {
    const plugins = useSortedPlugins();
    const { t } = useI18N();
    const colors = useColors();
    const route = useRoute<any>();
    const navigate = useNavigate();
    const initialPluginName = `${route.params?.initialPluginName ?? ""}`.trim();
    const [filterText, setFilterText] = useState(initialPluginName);
    const [sourceFilter, setSourceFilter] =
        useState<PluginSourceFilter>("all");
    const [capabilityFilter, setCapabilityFilter] =
        useState<PluginCapabilityFilter>("all");
    const [configFilter, setConfigFilter] =
        useState<PluginConfigFilter>("all");
    const [configRevision, setConfigRevision] = useState(0);
    const [enabledFilter, setEnabledFilter] =
        useState<PluginEnabledFilter>("all");
    const [enabledRevision, setEnabledRevision] = useState(0);
    const [diagnosticFilter, setDiagnosticFilter] =
        useState<PluginDiagnosticFilter>("all");
    useEffect(() => {
        setFilterText(initialPluginName);
    }, [initialPluginName]);

    const sourceFilterItems: Array<{
        value: PluginSourceFilter;
        label: string;
    }> = useMemo(() => [
        {
            value: "all",
            label: t("pluginSetting.filter.source.all"),
        },
        {
            value: "network",
            label: t("pluginSetting.pluginItem.source.network"),
        },
        {
            value: "local-file",
            label: t("pluginSetting.pluginItem.source.localFile"),
        },
        {
            value: "unknown",
            label: t("pluginSetting.pluginItem.source.unknown"),
        },
    ], [t]);

    const capabilityFilterItems = useMemo(() => [
        {
            value: "all",
            label: t("pluginSetting.filter.capability.all"),
        },
        ...pluginCapabilityConfigs.map(config => ({
            value: config.key,
            label: t(config.labelKey),
        })),
    ], [t]);

    const configFilterItems: Array<{
        value: PluginConfigFilter;
        label: string;
    }> = useMemo(() => [
        {
            value: "all",
            label: t("pluginSetting.filter.config.all"),
        },
        {
            value: "needs-config",
            label: t("pluginSetting.filter.config.needsConfig"),
        },
        {
            value: "configured",
            label: t("pluginSetting.filter.config.configured"),
        },
        {
            value: "no-config",
            label: t("pluginSetting.filter.config.noConfig"),
        },
    ], [t]);

    const enabledFilterItems: Array<{
        value: PluginEnabledFilter;
        label: string;
    }> = useMemo(() => [
        {
            value: "all",
            label: t("pluginSetting.filter.enabled.all"),
        },
        {
            value: "enabled",
            label: t("pluginSetting.filter.enabled.enabled"),
        },
        {
            value: "disabled",
            label: t("pluginSetting.filter.enabled.disabled"),
        },
    ], [t]);

    const diagnosticFilterItems: Array<{
        value: PluginDiagnosticFilter;
        label: string;
    }> = useMemo(() => [
        {
            value: "all",
            label: t("pluginSetting.filter.diagnostics.all"),
        },
        {
            value: "has-recent-error",
            label: t("pluginSetting.filter.diagnostics.hasRecentError"),
        },
        {
            value: "no-recent-error",
            label: t("pluginSetting.filter.diagnostics.noRecentError"),
        },
    ], [t]);

    const visiblePlugins = useMemo(() => {
        const keyword = filterText.trim().toLowerCase();
        const capabilityConfig = pluginCapabilityConfigs.find(
            config => config.key === capabilityFilter,
        );
        return plugins.filter(plugin => {
            const matchesKeyword = !keyword || [
                plugin.name,
                plugin.instance.author ?? "",
                plugin.instance.description ?? "",
            ].some(text => text.toLowerCase().includes(keyword));
            const matchesSource =
                sourceFilter === "all" ||
                getPluginSourceFilterValue(plugin) === sourceFilter;
            const matchesCapability =
                capabilityFilter === "all" ||
                (capabilityConfig
                    ? pluginSupportsCapability(plugin, capabilityConfig)
                    : true);
            const matchesConfig =
                configFilter === "all" ||
                getPluginConfigFilterValue(plugin) === configFilter;
            const matchesEnabled =
                enabledFilter === "all" ||
                getPluginEnabledFilterValue(plugin) === enabledFilter;
            const matchesDiagnostics =
                diagnosticFilter === "all" ||
                getPluginDiagnosticFilterValue(plugin) === diagnosticFilter;

            return matchesKeyword &&
                matchesSource &&
                matchesCapability &&
                matchesConfig &&
                matchesEnabled &&
                matchesDiagnostics;
        });
    }, [
        capabilityFilter,
        configFilter,
        configRevision,
        diagnosticFilter,
        enabledFilter,
        enabledRevision,
        filterText,
        plugins,
        sourceFilter,
    ]);

    const [loading, setLoading] = useState(false);

    const navigator = useNavigation<any>();

    function clearFilters() {
        setFilterText("");
        setSourceFilter("all");
        setCapabilityFilter("all");
        setConfigFilter("all");
        setEnabledFilter("all");
        setDiagnosticFilter("all");
    }

    function renderFilterChip(
        label: string,
        active: boolean,
        onPress: () => void,
    ) {
        return (
            <Pressable
                key={label}
                onPress={onPress}
                style={[
                    style.filterChip,
                    {
                        backgroundColor: active
                            ? colors.card
                            : colors.placeholder,
                        borderColor: active
                            ? colors.primary
                            : colors.divider,
                    },
                ]}>
                <ThemeText
                    fontSize="description"
                    color={active ? colors.primary : colors.textSecondary}
                    numberOfLines={1}>
                    {label}
                </ThemeText>
            </Pressable>
        );
    }

    function renderPluginListHeader() {
        const hasActiveFilters =
            !!filterText ||
            sourceFilter !== "all" ||
            capabilityFilter !== "all" ||
            configFilter !== "all" ||
            enabledFilter !== "all" ||
            diagnosticFilter !== "all";
        return (
            <View style={style.headerWrapper}>
                {filterText ? (
                    <ListItem
                        withHorizontalPadding
                        heightType="smallest"
                        onPress={() => setFilterText("")}>
                        <ListItem.Content
                            title={t(
                                "pluginSetting.filteringByPlugin",
                                {
                                    name: filterText,
                                },
                            )}
                        />
                        <ListItem.ListItemIcon
                            icon="x-mark"
                            position="right"
                        />
                    </ListItem>
                ) : null}
                <View style={style.filterHeader}>
                    <ThemeText
                        fontSize="subTitle"
                        fontWeight="semibold">
                        {t("pluginSetting.filter.title", {
                            count: visiblePlugins.length,
                            total: plugins.length,
                        })}
                    </ThemeText>
                    {hasActiveFilters ? (
                        <Pressable onPress={clearFilters} hitSlop={rpx(18)}>
                            <ThemeText
                                fontSize="description"
                                color={colors.primary}>
                                {t("pluginSetting.filter.clear")}
                            </ThemeText>
                        </Pressable>
                    ) : null}
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterRow}>
                    {sourceFilterItems.map(item =>
                        renderFilterChip(
                            item.label,
                            sourceFilter === item.value,
                            () => setSourceFilter(item.value),
                        ),
                    )}
                </ScrollView>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterRow}>
                    {capabilityFilterItems.map(item =>
                        renderFilterChip(
                            item.label,
                            capabilityFilter === item.value,
                            () => setCapabilityFilter(item.value),
                        ),
                    )}
                </ScrollView>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterRow}>
                    {configFilterItems.map(item =>
                        renderFilterChip(
                            item.label,
                            configFilter === item.value,
                            () => setConfigFilter(item.value),
                        ),
                    )}
                </ScrollView>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterRow}>
                    {enabledFilterItems.map(item =>
                        renderFilterChip(
                            item.label,
                            enabledFilter === item.value,
                            () => setEnabledFilter(item.value),
                        ),
                    )}
                </ScrollView>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterRow}>
                    {diagnosticFilterItems.map(item =>
                        renderFilterChip(
                            item.label,
                            diagnosticFilter === item.value,
                            () => setDiagnosticFilter(item.value),
                        ),
                    )}
                </ScrollView>
            </View>
        );
    }

    function onCopyPluginDiagnosticReport() {
        Clipboard.setString(buildPluginDiagnosticReport(plugins));
        Toast.success(t("toast.copiedToClipboard"));
    }

    function onExportPluginDiagnosticReport() {
        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("pluginSetting.diagnostics.exportReportAction"),
            async onAction(selectedFiles) {
                const folder = selectedFiles[0]?.path;
                if (!folder) {
                    return false;
                }
                try {
                    const filename = await writePluginDiagnosticReport(
                        folder,
                        buildPluginDiagnosticReport(plugins),
                    );
                    Toast.success(t(
                        "pluginSetting.diagnostics.exportReportSuccess",
                        { filename },
                    ));
                    return true;
                } catch (e: any) {
                    Toast.warn(t(
                        "pluginSetting.diagnostics.exportReportFailed",
                        { reason: e?.message ?? e },
                    ));
                    return false;
                }
            },
        });
    }

    const menuOptions: IOption[] = [
        {
            icon: "bookmark-square",
            title: t("pluginSetting.menu.subscriptionSetting"),
            async onPress() {
                navigator.navigate("/pluginsetting/subscribe");
            },
        },
        {
            icon: "bars-3",
            title: t("pluginSetting.menu.sort"),
            onPress() {
                navigator.navigate("/pluginsetting/sort");
            },
        },
        {
            icon: "exclamation-circle",
            title: t("pluginSetting.menu.diagnostics"),
            onPress() {
                navigator.navigate("/pluginsetting/diagnostics");
            },
        },
        {
            icon: "check-circle",
            title: t("pluginSetting.menu.capabilityMatrix"),
            onPress() {
                navigator.navigate("/pluginsetting/capability-matrix");
            },
        },
        {
            icon: "document-outline",
            title: t("pluginSetting.menu.copyDiagnosticReport"),
            onPress: onCopyPluginDiagnosticReport,
        },
        {
            icon: "arrow-up-tray",
            title: t("pluginSetting.menu.exportDiagnosticReport"),
            onPress: onExportPluginDiagnosticReport,
        },
        {
            icon: "trash-outline",
            title: t("pluginSetting.menu.uninstallAll"),
            onPress() {
                showDialog("SimpleDialog", {
                    title: t("pluginSetting.menu.uninstallAll"),
                    content: t("pluginSetting.menu.uninstallAllContent"),
                    async onOk() {
                        setLoading(true);
                        await PluginManager.uninstallAllPlugins();
                        setLoading(false);
                    },
                });
            },
        },
    ];

    async function onInstallFromLocalClick() {
        try {
            const results = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                multiple: true,
                type: [
                    "application/javascript",
                    "application/x-javascript",
                    "text/javascript",
                    "text/plain",
                    "application/octet-stream",
                    "*/*",
                ],
            });
            if (results.canceled) {
                // 用户取消
                return;
            }
            setLoading(true);

            const installResults = await Promise.all(
                results.assets.map(async it => {
                    const result = await PluginManager.installPluginFromLocalFile(it.uri, {
                        notCheckVersion: Config.getConfig(
                            "basic.notCheckPluginVersion",
                        ),
                        useExpoFs: true,
                    });
                    return {
                        ...result,
                        pluginUrl: result.pluginUrl ?? it.name ?? it.uri,
                        sourceType: result.sourceType ?? "local-file",
                    };
                }),
            );

            const successResults = installResults.filter(it => it.success);
            const failResults = installResults.filter(it => !it.success);
            showPluginInstallResults(successResults, failResults, t);
        } catch (e: any) {
            trace("插件安装失败", e?.message);
            Toast.warn(t("toast.installPluginFail", {
                reason: e?.message ?? "",
            }));
        }
        setLoading(false);
    }

    async function onInstallFromNetworkClick() {
        showPanel("SimpleInput", {
            title: t("pluginSetting.menu.installPlugin"),
            placeholder: t("pluginSetting.menu.installPluginDialogPlaceholder"),
            maxLength: 200,
            async onOk(text, closePanel) {
                setLoading(true);
                closePanel();

                const result = await installPluginFromUrlText(text.trim());

                // 检查是否全部安装成功
                const successResults: IInstallPluginResult[] = [];
                const failResults: IInstallPluginResult[] = [];
                for (let i = 0; i < result.length; ++i) {
                    if (result[i].success) {
                        successResults.push(result[i]);
                    } else {
                        failResults.push(result[i]);
                    }
                }

                showPluginInstallResults(successResults, failResults, t);


                setLoading(false);
            },
        });
    }

    async function onSubscribeClick() {
        const urls = Config.getConfig("plugin.subscribeUrl");
        if (!urls) {
            Toast.warn(t("toast.noSubscription"));
            return;
        }
        setLoading(true);

        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];

        try {
            const urlItems = JSON.parse(urls!);
            if (Array.isArray(urlItems)) {
                for (let i = 0; i < urlItems.length; ++i) {
                    const result = await installPluginFromUrlText(
                        urlItems[i].url,
                    );
                    if (result[0]) {
                        if (result[0].success) {
                            successResults.push(result[0]);
                        } else {
                            failResults.push(result[0]);
                        }
                    }
                }
            } else {
                throw new Error();
            }

            showPluginInstallResults(successResults, failResults, t);

        } catch {
            if (urls?.length) {
                const result = await installPluginFromUrlText(urls);
                if (result[0]) {
                    if (result[0].success) {
                        showPluginInstallResults([result[0]], [], t);
                    } else {
                        showPluginInstallResults([], [result[0]], t);
                    }
                } else {
                    Toast.warn(t("toast.subscriptionInvalid"));
                }
            }
        }
        setLoading(false);
    }

    async function onUpdateAllClick() {
        const plugins = PluginManager.getEnabledPlugins();
        setLoading(true);

        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];

        try {
            for (let i = 0; i < plugins.length; ++i) {
                const srcUrl = plugins[i].instance.srcUrl;
                if (srcUrl) {
                    const result = await installPluginFromUrlText(srcUrl);
                    if (result[0]) {
                        if (result[0].success) {
                            successResults.push(result[0]);
                        } else {
                            failResults.push(result[0]);
                        }
                    }
                }
            }

            if (!failResults.length) {
                Toast.success(t("toast.updatePluginSuccess"));
            } else {
                Toast.warn((successResults.length ? t("toast.partialPluginUpdateFailed") : t("toast.allPluginUpdateFailed")), {
                    "type": "warn",
                    "actionText": t("common.view"),
                    "onActionClick": () => {
                        showDialog("SimpleDialog", {
                            title: t("pluginSetting.menu.pluginUpdateFailedDialogTitle"),
                            content: t("pluginSetting.pluginUpdateFailedDialogContent", {
                                detail: failResults
                                    .map(it => formatPluginInstallResult(it, t))
                                    .join("\n-----\n"),
                            }),
                        });
                    },
                });
            }

        } catch (e: any) {
            Toast.warn(t("toast.unknownError", {
                reason: e?.message ?? e,
            }));
        }
        setLoading(false);
    }

    return (
        <>
            <AppBar
                actions={[
                    {
                        icon: "magnifying-glass",
                        onPress: () => navigate(ROUTE_PATH.GLOBAL_SEARCH),
                    },
                ]}
                menu={menuOptions}>
                {t("sidebar.pluginManagement")}
            </AppBar>
            <HorizontalSafeAreaView style={style.wrapper}>
                <>
                    {loading ? (
                        <Loading />
                    ) : (
                        <FlatList
                            ListEmptyComponent={Empty}
                            ListHeaderComponent={renderPluginListHeader}
                            ListFooterComponent={<View style={style.blank} />}
                            data={visiblePlugins ?? []}
                            keyExtractor={_ => _.hash}
                            renderItem={({ item: plugin }) => (
                                <PluginItem
                                    key={plugin.hash}
                                    plugin={plugin}
                                    onPluginConfigChanged={() =>
                                        setConfigRevision(value => value + 1)
                                    }
                                    onPluginEnabledChanged={() =>
                                        setEnabledRevision(value => value + 1)
                                    }
                                />
                            )}
                        />
                    )}

                    <Fab
                        icon="plus"
                        onPress={() => {
                            showPanel("SimpleSelect", {
                                header: t("pluginSetting.menu.installPlugin"),
                                candidates: [
                                    {
                                        value: "从本地安装插件",
                                        title: t("pluginSetting.fabOptions.installFromLocal"),
                                    },
                                    {
                                        value: "从网络安装插件",
                                        title: t("pluginSetting.fabOptions.installFromNetwork"),
                                    },
                                    {
                                        value: "更新全部插件",
                                        title: t("pluginSetting.fabOptions.updateAllPlugins"),
                                    },
                                    {
                                        value: "更新订阅",
                                        title: t("pluginSetting.fabOptions.updateSubscription"),
                                    },
                                ],
                                onPress(item) {
                                    if (item.value === "从本地安装插件") {
                                        onInstallFromLocalClick();
                                    } else if (
                                        item.value === "从网络安装插件"
                                    ) {
                                        onInstallFromNetworkClick();
                                    } else if (item.value === "更新订阅") {
                                        onSubscribeClick();
                                    } else if (item.value === "更新全部插件") {
                                        onUpdateAllClick();
                                    }
                                },
                            });
                        }}
                    />
                </>
            </HorizontalSafeAreaView>
        </>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    headerWrapper: {
        paddingTop: rpx(20),
    },
    filterHeader: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(8),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    filterRow: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(8),
        columnGap: rpx(12),
    },
    filterChip: {
        maxWidth: rpx(220),
        minHeight: rpx(52),
        borderRadius: rpx(26),
        borderWidth: 1,
        paddingHorizontal: rpx(18),
        alignItems: "center",
        justifyContent: "center",
    },
    blank: {
        height: rpx(200),
    },
});
