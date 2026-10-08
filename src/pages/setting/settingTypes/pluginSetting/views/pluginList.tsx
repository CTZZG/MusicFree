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
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import AppBar from "@/components/base/appBar";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import ThemeText from "@/components/base/themeText";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import PluginItem from "../components/pluginItem";
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
    buildPluginDiagnosticReport,
    clearPluginDiagnosticEvents,
    getRecentPluginDiagnosticErrors,
} from "@/core/pluginManager/diagnostics";
import Clipboard from "@react-native-clipboard/clipboard";
import { ScrollView } from "react-native-gesture-handler";
import Paragraph from "@/components/base/paragraph";

// iOS 系统色图标块，和设置页一致
const TINT = {
    indigo: "#5856D6",
    gray: "#8E8E93",
    purple: "#AF52DE",
    blue: "#007AFF",
    green: "#34C759",
};

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
            ReturnType<typeof getRecentPluginDiagnosticErrors>[number]
        >();
        if (!pluginRevision) {
            return byPlugin;
        }
        // 只看时间窗内的错误：否则安装以来的每一次失败都会永久显示，
        // 包括早已修复的（例如插件 HTTP 策略调整之前记录的那批）；
        // 能力使用、数据迁移这类 info 记录也不算错误。
        for (const event of getRecentPluginDiagnosticErrors()) {
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

    const bottomInset = Math.max(useMusicBarFloatingOffset(24), 32);

    // 诊断数据一直在写 MMKV，但此前没有任何界面能读出来——
    // buildPluginDiagnosticReport 写好却从未被调用。结果插件安装/挂载
    // 失败时只能看到一句被截断的 message，真实异常与堆栈位置无从获取。
    function onCopyDiagnosticsClick() {
        const report = buildPluginDiagnosticReport(plugins ?? []);
        showDialog("SimpleDialog", {
            title: t("pluginSetting.menu.copyDiagnostics"),
            content: (
                <ScrollView>
                    <Paragraph>{report}</Paragraph>
                </ScrollView>
            ),
            cancelText: t("dialog.errorLogKnow"),
            okText: t("dialog.errorLogCopy"),
            onOk() {
                Clipboard.setString(report);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    function onClearDiagnosticsClick() {
        const cleared = clearPluginDiagnosticEvents();
        setDiagnosticRevision(revision => revision + 1);
        Toast.success(
            t("pluginSetting.menu.clearDiagnosticsDone", {
                count: String(cleared),
            }),
        );
    }

    function onUninstallAllClick() {
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
    }

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

    // 右上角的 + 只管安装；更新、订阅、排序这些常用入口直接放在页面上，
    // 不再藏进右上角的 ⋮ 菜单和右下角的悬浮按钮
    function onInstallClick() {
        showPanel("SimpleSelect", {
            header: t("pluginSetting.menu.installPlugin"),
            candidates: [
                {
                    value: "local",
                    title: t("pluginSetting.fabOptions.installFromLocal"),
                },
                {
                    value: "network",
                    title: t("pluginSetting.fabOptions.installFromNetwork"),
                },
                {
                    value: "lx",
                    title: t("pluginSetting.fabOptions.importLxSource"),
                },
            ],
            onPress(item) {
                if (item.value === "local") {
                    onInstallFromLocalClick();
                } else if (item.value === "network") {
                    onInstallFromNetworkClick();
                } else if (item.value === "lx") {
                    onInstallLxSourceClick();
                }
            },
        });
    }

    const hasPlugins = (plugins?.length ?? 0) > 0;

    const listHeader = (
        <View>
            <GroupedSection dividerInset={58}>
                <GroupedRow
                    icon="bookmark-square"
                    iconTint={TINT.indigo}
                    title={t("pluginSetting.menu.subscriptionSetting")}
                    accessory="chevron"
                    onPress={() => navigator.navigate("/pluginsetting/subscribe")}
                />
                <GroupedRow
                    icon="bars-3"
                    iconTint={TINT.gray}
                    title={t("pluginSetting.menu.sort")}
                    accessory="chevron"
                    onPress={() => navigator.navigate("/pluginsetting/sort")}
                />
                <GroupedRow
                    icon="javascript"
                    iconTint={TINT.purple}
                    title={t("lxSource.title")}
                    accessory="chevron"
                    onPress={() => navigator.navigate("/pluginsetting/lx-source")}
                />
            </GroupedSection>
            <GroupedSection
                dividerInset={58}
                footer={t("pluginSetting.updateFooter")}>
                <GroupedRow
                    icon="arrow-down-tray"
                    iconTint={TINT.blue}
                    title={t("pluginSetting.fabOptions.updateSubscription")}
                    onPress={onSubscribeClick}
                />
                <GroupedRow
                    icon="arrow-path"
                    iconTint={TINT.green}
                    title={t("pluginSetting.fabOptions.updateAllPlugins")}
                    onPress={onUpdateAllClick}
                />
            </GroupedSection>
            {hasPlugins ? (
                <ThemeText
                    accessibilityRole="header"
                    fontSize="description"
                    fontColor="textSecondary"
                    style={style.sectionTitle}>
                    {t("pluginSetting.section.installed")}
                </ThemeText>
            ) : null}
        </View>
    );

    const listFooter = (
        <View style={{ paddingBottom: bottomInset }}>
            <GroupedSection title={t("pluginSetting.section.diagnostics")}>
                <GroupedRow
                    title={t("pluginSetting.menu.copyDiagnostics")}
                    onPress={onCopyDiagnosticsClick}
                />
                <GroupedRow
                    title={t("pluginSetting.menu.clearDiagnostics")}
                    onPress={onClearDiagnosticsClick}
                />
            </GroupedSection>
            {hasPlugins ? (
                <GroupedSection>
                    <GroupedRow
                        title={t("pluginSetting.menu.uninstallAll")}
                        destructive
                        onPress={onUninstallAllClick}
                    />
                </GroupedSection>
            ) : null}
        </View>
    );

    // 标题栏也放在让开左右安全区的容器里：横屏时右上角的 + 不落进系统栏、挖孔
    return (
        <HorizontalSafeAreaView style={style.wrapper}>
            <AppBar
                backgroundColor="transparent"
                spacious
                actions={[
                    {
                        icon: "plus",
                        accessibilityLabel: t("pluginSetting.menu.installPlugin"),
                        onPress: onInstallClick,
                    },
                ]}>
                {t("sidebar.pluginManagement")}
            </AppBar>
            {loading ? (
                <Loading />
            ) : (
                <FlashList
                    style={style.list}
                    ListHeaderComponent={listHeader}
                    ListEmptyComponent={PluginListEmpty}
                    ListFooterComponent={listFooter}
                    data={plugins ?? []}
                    drawDistance={rpx(320)}
                    keyExtractor={keyExtractor}
                    renderItem={renderPluginItem}
                />
            )}
        </HorizontalSafeAreaView>
    );
}

function PluginListEmpty() {
    const { t } = useI18N();
    return (
        <ThemeText
            fontSize="description"
            fontColor="textSecondary"
            style={style.emptyHint}>
            {t("pluginSetting.empty")}
        </ThemeText>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    list: {
        flex: 1,
    },
    sectionTitle: {
        marginTop: 22,
        marginHorizontal: 32,
        marginBottom: 1,
    },
    emptyHint: {
        marginTop: 28,
        marginHorizontal: 32,
        textAlign: "center",
    },
});
