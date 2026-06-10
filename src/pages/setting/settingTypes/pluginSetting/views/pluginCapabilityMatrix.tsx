import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Color from "color";
import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import pluginManager, { type Plugin, useSortedPlugins } from "@/core/pluginManager";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import {
    getPluginSourceInfo,
    pluginCapabilityConfigs,
    pluginSupportsCapability,
} from "../capabilityUtils";

function getSupportedCount(plugin: Plugin) {
    return pluginCapabilityConfigs.filter(capability =>
        pluginSupportsCapability(plugin, capability),
    ).length;
}

export default function PluginCapabilityMatrix() {
    const { t } = useI18N();
    const colors = useColors();
    const plugins = useSortedPlugins();

    return (
        <>
            <AppBar>{t("pluginSetting.menu.capabilityMatrix")}</AppBar>
            <HorizontalSafeAreaView style={styles.wrapper}>
                <View style={styles.summary}>
                    <ThemeText fontColor="textSecondary">
                        {t("pluginSetting.capabilityMatrix.summary", {
                            pluginCount: plugins.length,
                            capabilityCount: pluginCapabilityConfigs.length,
                        })}
                    </ThemeText>
                </View>
                {plugins.length ? (
                    <ScrollView
                        horizontal
                        style={styles.matrixScroll}
                        contentContainerStyle={styles.matrixContent}>
                        <View>
                            <MatrixHeader />
                            <ScrollView>
                                {plugins.map(plugin => (
                                    <MatrixRow
                                        key={plugin.hash}
                                        plugin={plugin}
                                    />
                                ))}
                            </ScrollView>
                        </View>
                    </ScrollView>
                ) : (
                    <Empty content={t("pluginSetting.capabilityMatrix.empty")} />
                )}
            </HorizontalSafeAreaView>
        </>
    );
}

function MatrixHeader() {
    const { t } = useI18N();
    const colors = useColors();

    return (
        <View
            style={[
                styles.row,
                styles.headerRow,
                { borderBottomColor: Color(colors.text).alpha(0.08).toString() },
            ]}>
            <HeaderCell
                width={styles.pluginCell.width}
                title={t("pluginSetting.capabilityMatrix.plugin")}
            />
            <HeaderCell
                width={styles.statusCell.width}
                title={t("pluginSetting.capabilityMatrix.status")}
            />
            <HeaderCell
                width={styles.sourceCell.width}
                title={t("pluginSetting.capabilityMatrix.source")}
            />
            <HeaderCell
                width={styles.countCell.width}
                title={t("pluginSetting.capabilityMatrix.supportedCount")}
            />
            {pluginCapabilityConfigs.map(capability => (
                <HeaderCell
                    key={capability.key}
                    width={styles.capabilityCell.width}
                    title={t(capability.labelKey)}
                    centered
                />
            ))}
        </View>
    );
}

function HeaderCell(props: {
    title: string;
    width: number;
    centered?: boolean;
}) {
    return (
        <View
            style={[
                styles.cell,
                { width: props.width },
                props.centered ? styles.centerCell : null,
            ]}>
            <ThemeText
                fontSize="description"
                fontWeight="semibold"
                numberOfLines={2}>
                {props.title}
            </ThemeText>
        </View>
    );
}

function MatrixRow(props: { plugin: Plugin }) {
    const { plugin } = props;
    const { t } = useI18N();
    const colors = useColors();
    const sourceInfo = getPluginSourceInfo(plugin, t);
    const enabled = pluginManager.isPluginEnabled(plugin);
    const supportedCount = getSupportedCount(plugin);

    return (
        <View
            style={[
                styles.row,
                {
                    borderBottomColor: Color(colors.text)
                        .alpha(0.06)
                        .toString(),
                },
            ]}>
            <View style={[styles.cell, styles.pluginCell]}>
                <ThemeText numberOfLines={1} fontWeight="semibold">
                    {plugin.name}
                </ThemeText>
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    numberOfLines={1}
                    style={styles.pluginMeta}>
                    {plugin.instance.version ?? "-"}
                </ThemeText>
            </View>
            <View style={[styles.cell, styles.statusCell]}>
                <ThemeText
                    fontSize="description"
                    color={enabled ? colors.primary : colors.textSecondary}
                    numberOfLines={1}>
                    {enabled
                        ? t("pluginSetting.capabilityMatrix.enabled")
                        : t("pluginSetting.capabilityMatrix.disabled")}
                </ThemeText>
            </View>
            <View style={[styles.cell, styles.sourceCell]}>
                <ThemeText fontSize="description" numberOfLines={1}>
                    {sourceInfo.label}
                </ThemeText>
            </View>
            <View style={[styles.cell, styles.countCell]}>
                <ThemeText fontSize="description" numberOfLines={1}>
                    {`${supportedCount}/${pluginCapabilityConfigs.length}`}
                </ThemeText>
            </View>
            {pluginCapabilityConfigs.map(capability => {
                const supported = pluginSupportsCapability(plugin, capability);
                return (
                    <View
                        key={capability.key}
                        style={[
                            styles.cell,
                            styles.capabilityCell,
                            styles.centerCell,
                        ]}>
                        <Icon
                            name={supported ? "check-circle" : "minus"}
                            color={
                                supported
                                    ? colors.primary
                                    : Color(colors.textSecondary)
                                        .alpha(0.38)
                                        .toString()
                            }
                            size={rpx(30)}
                        />
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    summary: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(20),
        paddingBottom: rpx(12),
    },
    matrixScroll: {
        flex: 1,
    },
    matrixContent: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(36),
    },
    row: {
        minHeight: rpx(76),
        flexDirection: "row",
        borderBottomWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
    },
    headerRow: {
        minHeight: rpx(88),
    },
    cell: {
        minHeight: rpx(76),
        paddingHorizontal: rpx(12),
        justifyContent: "center",
    },
    centerCell: {
        alignItems: "center",
    },
    pluginCell: {
        width: rpx(260),
    },
    statusCell: {
        width: rpx(112),
    },
    sourceCell: {
        width: rpx(144),
    },
    countCell: {
        width: rpx(116),
    },
    capabilityCell: {
        width: rpx(104),
    },
    pluginMeta: {
        marginTop: rpx(8),
    },
});
