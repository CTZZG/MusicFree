import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import rpx from "@/utils/rpx";
import Config, { useAppConfig } from "@/core/appConfig";
import { FlatList } from "react-native-gesture-handler";
import Empty from "@/components/base/empty";
import ListItem from "@/components/base/listItem";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import Fab from "@/components/base/fab";
import { useI18N } from "@/core/i18n";
import Loading from "@/components/base/loading";
import {
    getPluginSubscriptionUrlKind,
    installPluginFromUrlText,
    isPluginSubscriptionUrlSupported,
    PluginSubscriptionUrlKind,
    showPluginInstallResults,
} from "../installPluginUtils";

interface ISubscribeItem {
    name: string;
    url: string;
}

const ITEM_HEIGHT = rpx(108);

export default function PluginSubscribe() {
    const urls = useAppConfig("plugin.subscribeUrl") ?? "";
    const [subscribes, setSubscribes] = useState<Array<ISubscribeItem>>([]);
    const [loading, setLoading] = useState(false);

    const { t } = useI18N();

    useEffect(() => {
        try {
            const parsed = JSON.parse(urls);
            if (Array.isArray(parsed)) {
                setSubscribes(
                    parsed
                        .map((item, index) => ({
                            name:
                                `${item?.name ?? ""}`.trim() ||
                                `${t("common.default")} ${index + 1}`,
                            url: `${item?.url ?? ""}`.trim(),
                        }))
                        .filter(item => item.url),
                );
            } else {
                throw new Error();
            }
        } catch {
            if (urls.length) {
                setSubscribes([
                    {
                        name: t("common.default"),
                        url: urls,
                    },
                ]);
            } else {
                setSubscribes([]);
            }
        }
    }, [t, urls]);

    const onSubmit = (
        subscribeItem: ISubscribeItem,
        hideDialog: () => void,
        editingIndex?: number,
    ) => {
        if (isPluginSubscriptionUrlSupported(subscribeItem.url)) {
            if (editingIndex !== undefined) {
                Config.setConfig(
                    "plugin.subscribeUrl",
                    JSON.stringify([
                        ...subscribes.slice(0, editingIndex),
                        subscribeItem,
                        ...subscribes.slice(editingIndex + 1),
                    ]),
                );
            } else {
                Config.setConfig(
                    "plugin.subscribeUrl",
                    JSON.stringify([...subscribes, subscribeItem]),
                );
            }
            hideDialog();
        } else {
            Toast.warn(t("toast.subscriptionHaveToEndWithJs"));
        }
    };

    function getSubscribeKindLabel(kind: PluginSubscriptionUrlKind) {
        if (kind === "single-plugin") {
            return t("pluginSetting.subscription.urlType.singlePlugin");
        }
        if (kind === "collection") {
            return t("pluginSetting.subscription.urlType.collection");
        }
        return t("pluginSetting.subscription.urlType.invalid");
    }

    async function onUpdateSubscribe(subscribeItem: ISubscribeItem) {
        if (loading) {
            return;
        }
        setLoading(true);
        try {
            const installResults = await installPluginFromUrlText(
                subscribeItem.url,
                {
                    requireSupportedExtension: true,
                },
            );
            const successResults = installResults.filter(it => it.success);
            const failResults = installResults.filter(it => !it.success);
            showPluginInstallResults(successResults, failResults, t);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <AppBar>{t("pluginSetting.menu.subscriptionSetting")}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                {loading ? (
                    <Loading />
                ) : (
                    <FlatList
                        style={style.listWrapper}
                        ListEmptyComponent={Empty}
                        data={subscribes}
                        renderItem={({ item, index }) => {
                            const urlKind = getPluginSubscriptionUrlKind(
                                item.url,
                            );
                            const kindLabel = getSubscribeKindLabel(urlKind);
                            return (
                                <ListItem
                                    withHorizontalPadding
                                    rightPadding={rpx(4)}
                                    onPress={() => {
                                        showDialog("SubscribePluginDialog", {
                                            subscribeItem: item,
                                            onSubmit,
                                            editingIndex: index,
                                            onDelete(editingIndex, hideDialog) {
                                                Config.setConfig(
                                                    "plugin.subscribeUrl",
                                                    JSON.stringify([
                                                        ...subscribes.slice(
                                                            0,
                                                            editingIndex,
                                                        ),
                                                        ...subscribes.slice(
                                                            editingIndex + 1,
                                                        ),
                                                    ]),
                                                );
                                                hideDialog();
                                                Toast.success(t("toast.deleteSuccess"));
                                            },
                                        });
                                    }}>
                                    <ListItem.Content
                                        title={item.name}
                                        description={`${kindLabel} · ${item.url}`}
                                    />
                                    {urlKind === "invalid" ? (
                                        <ListItem.ListItemIcon
                                            icon="exclamation-circle"
                                            position="right"
                                        />
                                    ) : (
                                        <ListItem.ListItemIcon
                                            icon="arrow-path"
                                            position="right"
                                            onPress={() => {
                                                void onUpdateSubscribe(item);
                                            }}
                                        />
                                    )}
                                    <ListItem.ListItemIcon
                                        icon="share"
                                        position="right"
                                        onPress={() => {
                                            Clipboard.setString(item.url);
                                            Toast.success(t("toast.copiedToClipboard"));
                                        }}
                                    />
                                </ListItem>
                            );
                        }}
                        getItemLayout={(_, index) => ({
                            length: ITEM_HEIGHT,
                            offset: ITEM_HEIGHT * index,
                            index,
                        })}
                    />
                )}
            </HorizontalSafeAreaView>
            <Fab
                icon="plus"
                onPress={() => {
                    showDialog("SubscribePluginDialog", {
                        onSubmit,
                    });
                }}
            />
        </>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
    },
    listWrapper: {
        marginTop: rpx(24),
    },
    fab: {
        position: "absolute",
        right: rpx(36),
        bottom: rpx(36),
    },
});
