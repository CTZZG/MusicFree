import React, { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import Fab from "@/components/base/fab";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import IconButton from "@/components/base/iconButton";
import ListItem from "@/components/base/listItem";
import Loading from "@/components/base/loading";
import ThemeSwitch from "@/components/base/switch";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import LxSource, { ILxSourceItem, useLxSources } from "@/core/lxSource";
import { useI18N } from "@/core/i18n";
import globalStyle from "@/constants/globalStyle";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

function getSourceDescription(source: ILxSourceItem) {
    return [
        source.metadata.version ? `v${source.metadata.version}` : "",
        source.metadata.author,
        source.sourceUrl,
    ].filter(Boolean).join(" · ");
}

export default function LxSourceList() {
    const sources = useLxSources();
    const [loading, setLoading] = useState(false);
    const { t } = useI18N();

    async function installFromUrl(url: string) {
        const result = await LxSource.installFromUrl(url);
        if (result.success) {
            Toast.success(t("lxSource.installSuccess", {
                name: result.item?.metadata.name ?? "",
            }));
        } else {
            Toast.warn(t("lxSource.installFailed", {
                reason: result.message ?? "",
            }));
        }
    }

    function onInstallFromUrlClick() {
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
                    await installFromUrl(url);
                } finally {
                    setLoading(false);
                }
            },
        });
    }

    async function onInstallFromLocalClick() {
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
            const installResult = await LxSource.installFromLocalFile(asset.uri, {
                useExpoFs: true,
            });
            if (installResult.success) {
                Toast.success(t("lxSource.installSuccess", {
                    name: installResult.item?.metadata.name ?? asset.name ?? "",
                }));
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
    }

    async function onUpdate(source: ILxSourceItem) {
        if (!source.sourceUrl) {
            return;
        }
        setLoading(true);
        try {
            const result = await LxSource.updateSource(source.id);
            if (result.success) {
                Toast.success(t("lxSource.updateSuccess", {
                    name: result.item?.metadata.name ?? source.metadata.name,
                }));
            } else {
                Toast.warn(t("lxSource.updateFailed", {
                    reason: result.message ?? "",
                }));
            }
        } finally {
            setLoading(false);
        }
    }

    function onDelete(source: ILxSourceItem) {
        showDialog("SimpleDialog", {
            title: t("lxSource.delete"),
            content: t("lxSource.deleteConfirm", {
                name: source.metadata.name,
            }),
            onOk() {
                LxSource.deleteSource(source.id);
                Toast.success(t("toast.deleteSuccess"));
            },
        });
    }

    function renderSourceItem({ item }: { item: ILxSourceItem }) {
        return (
            <ListItem
                withHorizontalPadding
                rightPadding={rpx(4)}>
                <ListItem.Content
                    title={item.metadata.name}
                    description={getSourceDescription(item)}
                />
                <ThemeSwitch
                    value={item.enabled}
                    onValueChange={enabled => {
                        LxSource.setEnabled(item.id, enabled);
                    }}
                />
                {item.sourceUrl ? (
                    <IconButton
                        name="arrow-path"
                        onPress={() => {
                            void onUpdate(item);
                        }}
                    />
                ) : null}
                <IconButton
                    name="trash-outline"
                    onPress={() => {
                        onDelete(item);
                    }}
                />
            </ListItem>
        );
    }

    return (
        <>
            <AppBar backgroundColor="transparent" spacious>
                {t("lxSource.title")}
            </AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                {loading ? (
                    <Loading />
                ) : (
                    <FlatList
                        ListEmptyComponent={<Empty content={t("lxSource.empty")} />}
                        ListFooterComponent={<View style={style.blank} />}
                        data={sources}
                        keyExtractor={item => item.id}
                        renderItem={renderSourceItem}
                    />
                )}
            </HorizontalSafeAreaView>
            <Fab
                icon="plus"
                onPress={() => {
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
                            if (item.value === "url") {
                                onInstallFromUrlClick();
                            } else if (item.value === "local") {
                                void onInstallFromLocalClick();
                            }
                        },
                    });
                }}
            />
        </>
    );
}

const style = StyleSheet.create({
    blank: {
        height: rpx(200),
    },
});
