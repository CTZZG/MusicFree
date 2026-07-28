import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
import Loading from "@/components/base/loading";

import PluginManager, { Plugin, useSortedPlugins } from "@/core/pluginManager";
import { trace } from "@/utils/log";

import Toast from "@/utils/toast";
import { useNavigation } from "@react-navigation/native";
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
import {
    createPluginInstaller,
    formatPluginInstallResult,
    installPluginFromUrlText,
    installPluginsFromUrlTexts,
    runPluginInstallBatchWithCapabilityApproval,
    showPluginInstallResults,
} from "../installPluginUtils";
import {
    clearPluginDiagnosticEvents,
    getRecentPluginDiagnosticEvents,
} from "@/core/pluginManager/diagnostics";

interface IOption {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

export default function PluginList() {
    const plugins = useSortedPlugins();
    const { t } = useI18N();
    const [loading, setLoading] = useState(false);

    const navigator = useNavigation<any>();
    // 诊断事件存在 MMKV 里，不是响应式的；清除后靠这个计数触发重算。
    const [diagnosticRevision, setDiagnosticRevision] = useState(0);
    const pluginRevision = (plugins ?? [])
        .map(plugin => plugin.hash)
        .join("\u0000");
    const latestDiagnostics = useMemo(() => {
        const byPlugin = new Map<
            string,
            ReturnType<typeof getRecentPluginDiagnosticEvents>[number]
        >();
        if (!pluginRevision) {
            return byPlugin;
        }
        // 只看时间窗内的事件：否则安装以来的每一次失败都会永久显示，
        // 包括早已修复的（例如插件 HTTP 策略调整之前记录的那批）。
        for (const event of getRecentPluginDiagnosticEvents()) {
            const key = event.pluginHash ?? event.pluginName;
            if (key && !byPlugin.has(key)) {
                byPlugin.set(key, event);
            }
        }
        return byPlugin;
        // diagnosticRevision looks unused to the lint rule because the events come
        // from MMKV rather than from props/state. It is the invalidation signal
        // after "clear diagnostics", so it must stay in the dependency list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pluginRevision, diagnosticRevision]);

    const menuOptions = useMemo<IOption[]>(() => [
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
            icon: "javascript",
            title: t("lxSource.title"),
            onPress() {
                navigator.navigate("/pluginsetting/lx-source");
            },
        },
        {
            icon: "document-outline",
            title: t("pluginSetting.menu.clearDiagnostics"),
            onPress() {
                const cleared = clearPluginDiagnosticEvents();
                setDiagnosticRevision(revision => revision + 1);
                Toast.success(
                    t("pluginSetting.menu.clearDiagnosticsDone", {
                        count: String(cleared),
                    }),
                );
            },
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
                        try {
                            await PluginManager.uninstallAllPlugins();
                        } finally {
                            setLoading(false);
                        }
                    },
                });
            },
        },
    ], [navigator, t]);

    const renderPluginItem = useCallback(
        ({ item }: { item: Plugin }) => (
            <PluginItem
                plugin={item}
                latestDiagnostic={
                    latestDiagnostics.get(item.hash) ??
                    latestDiagnostics.get(item.name) ??
                    null
                }
            />
        ),
        [latestDiagnostics],
    );
    const keyExtractor = useCallback(
        (plugin: Plugin) => plugin.hash,
        [],
    );

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

            const installResults =
                await runPluginInstallBatchWithCapabilityApproval(
                    results.assets.map(it =>
                        createPluginInstaller(
                            {
                                pluginUrl: it.name ?? it.uri,
                                sourceType: "local-file",
                            },
                            approvedCapabilities =>
                                PluginManager.installPluginFromLocalFile(
                                    it.uri,
                                    {
                                        notCheckVersion: Config.getConfig(
                                            "basic.notCheckPluginVersion",
                                        ),
                                        useExpoFs: true,
                                        approvedCapabilities,
                                    },
                                ),
                        ),
                    ),
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
                try {
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
                } finally {
                    setLoading(false);
                }
            },
        });
    }

    async function onInstallLxSourceFromLocalClick() {
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
            setLoading(true);
            const installResult = await (await import("@/core/lxSource")).default
                .installFromLocalFile(asset.uri, {
                    useExpoFs: true,
                });
            if (installResult.success) {
                Toast.success(t("lxSource.installSuccess", {
                    name: installResult.item?.metadata.name ?? asset.name ?? "",
                }));
                navigator.navigate("/pluginsetting/lx-source");
            } else {
                Toast.warn(t("lxSource.installFailed", {
                    reason: installResult.message ?? "",
                }));
            }
        } catch (e: any) {
            Toast.warn(t("lxSource.installFailed", {
                reason: e?.message ?? "",
            }));
        }
        setLoading(false);
    }

    function onInstallLxSourceClick() {
        showPanel("SimpleSelect", {
            header: t("lxSource.import"),
            candidates: [
                {
                    value: "url",
                    title: t("lxSource.importFromUrl"),
                },
                {
                    value: "local",
                    title: t("lxSource.importFromLocal"),
                },
            ],
            onPress(item) {
                if (item.value === "local") {
                    onInstallLxSourceFromLocalClick();
                } else if (item.value === "url") {
                    showPanel("SimpleInput", {
                        title: t("lxSource.importFromUrl"),
                        placeholder: t("lxSource.importUrlPlaceholder"),
                        maxLength: 500,
                        async onOk(text, closePanel) {
                            const url = text.trim();
                            if (!url) {
                                return;
                            }
                            closePanel();
                            setLoading(true);
                            try {
                                const installResult = await (await import("@/core/lxSource")).default
                                    .installFromUrl(url);
                                if (installResult.success) {
                                    Toast.success(t("lxSource.installSuccess", {
                                        name: installResult.item?.metadata.name ?? "",
                                    }));
                                    navigator.navigate("/pluginsetting/lx-source");
                                } else {
                                    Toast.warn(t("lxSource.installFailed", {
                                        reason: installResult.message ?? "",
                                    }));
                                }
                            } catch (e: any) {
                                Toast.warn(t("lxSource.installFailed", {
                                    reason: e?.message ?? "",
                                }));
                            } finally {
                                setLoading(false);
                            }
                        },
                    });
                }
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

        try {
            let subscriptionUrls: string[];
            try {
                const urlItems = JSON.parse(urls);
                if (!Array.isArray(urlItems)) {
                    throw new Error();
                }
                subscriptionUrls = urlItems
                    .map(item =>
                        typeof item?.url === "string"
                            ? item.url.trim()
                            : "",
                    )
                    .filter(Boolean);
            } catch {
                subscriptionUrls = [urls];
            }

            if (!subscriptionUrls.length) {
                Toast.warn(t("toast.subscriptionInvalid"));
                return;
            }

            const results =
                await installPluginsFromUrlTexts(subscriptionUrls);
            const successResults = results.filter(result => result.success);
            const failResults = results.filter(result => !result.success);
            showPluginInstallResults(successResults, failResults, t);
        } finally {
            setLoading(false);
        }
    }

    async function onUpdateAllClick() {
        const enabledPlugins = PluginManager.getEnabledPlugins();
        setLoading(true);

        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];

        try {
            const sourceUrls = enabledPlugins
                .map(plugin => plugin.instance.srcUrl)
                .filter((url): url is string => Boolean(url));
            const results = await installPluginsFromUrlTexts(sourceUrls);
            for (const result of results) {
                if (result.success) {
                    successResults.push(result);
                } else {
                    failResults.push(result);
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
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <AppBar backgroundColor="transparent" spacious menu={menuOptions}>
                {t("sidebar.pluginManagement")}
            </AppBar>
            <HorizontalSafeAreaView style={style.wrapper}>
                <>
                    {loading ? (
                        <Loading />
                    ) : (
                        <FlashList
                            style={style.list}
                            ListEmptyComponent={Empty}
                            ListFooterComponent={PluginListFooter}
                            data={plugins ?? []}
                            drawDistance={rpx(320)}
                            keyExtractor={keyExtractor}
                            renderItem={renderPluginItem}
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
                                        value: "导入LX自定义源",
                                        title: t("pluginSetting.fabOptions.importLxSource"),
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
                                    } else if (item.value === "导入LX自定义源") {
                                        onInstallLxSourceClick();
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

function PluginListFooter() {
    return <View style={style.blank} />;
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    list: {
        flex: 1,
    },
    blank: {
        height: rpx(200),
    },
});
