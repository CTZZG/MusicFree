import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
import Loading from "@/components/base/loading";

import PluginManager, { useSortedPlugins } from "@/core/pluginManager";
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
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Clipboard from "@react-native-clipboard/clipboard";
import { buildPluginDiagnosticReport } from "@/core/pluginManager/diagnostics";
import {
    formatPluginInstallResult,
    installPluginFromUrlText,
    showPluginInstallResults,
} from "../installPluginUtils";

interface IOption {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

export default function PluginList() {
    const plugins = useSortedPlugins();
    const { t } = useI18N();
    const route = useRoute<any>();
    const navigate = useNavigate();
    const initialPluginName = `${route.params?.initialPluginName ?? ""}`.trim();
    const [filterText, setFilterText] = useState(initialPluginName);
    const visiblePlugins = useMemo(() => {
        const keyword = filterText.trim().toLowerCase();
        if (!keyword) {
            return plugins;
        }
        return plugins.filter(plugin =>
            [
                plugin.name,
                plugin.instance.author ?? "",
                plugin.instance.description ?? "",
            ].some(text => text.toLowerCase().includes(keyword)),
        );
    }, [filterText, plugins]);

    const [loading, setLoading] = useState(false);

    const navigator = useNavigation<any>();

    function onCopyPluginDiagnosticReport() {
        Clipboard.setString(buildPluginDiagnosticReport(plugins));
        Toast.success(t("toast.copiedToClipboard"));
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
            icon: "document-outline",
            title: t("pluginSetting.menu.copyDiagnosticReport"),
            onPress: onCopyPluginDiagnosticReport,
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
                            ListHeaderComponent={
                                filterText ? (
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
                                ) : null
                            }
                            ListFooterComponent={<View style={style.blank} />}
                            data={visiblePlugins ?? []}
                            keyExtractor={_ => _.hash}
                            renderItem={({ item: plugin }) => (
                                <PluginItem key={plugin.hash} plugin={plugin} />
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
    blank: {
        height: rpx(200),
    },
});
