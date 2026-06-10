import React, { useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import Color from "color";
import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import { useI18N } from "@/core/i18n";
import { useSortedPlugins } from "@/core/pluginManager";
import {
    buildPluginDiagnosticEventReport,
    buildPluginDiagnosticReport,
    getAllPluginDiagnosticEvents,
    PluginDiagnosticEvent,
} from "@/core/pluginManager/diagnostics";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import type { ILanguageData } from "@/types/core/i18n";

type DiagnosticFilter = "all" | "search" | "source" | "lyric" | "install" | "other";

const diagnosticFilterConfigs: Array<{
    key: DiagnosticFilter;
    icon: IIconName;
    methods?: string[];
}> = [
    {
        key: "all",
        icon: "document-outline",
    },
    {
        key: "search",
        icon: "magnifying-glass",
        methods: ["search"],
    },
    {
        key: "source",
        icon: "motion-play",
        methods: ["getMediaSource"],
    },
    {
        key: "lyric",
        icon: "lyric",
        methods: ["getLyric", "getWordByWordLyric"],
    },
    {
        key: "install",
        icon: "javascript",
        methods: ["mount", "install"],
    },
    {
        key: "other",
        icon: "exclamation-circle",
    },
];

const diagnosticFilterI18nKeys: Record<DiagnosticFilter, keyof ILanguageData> = {
    all: "pluginSetting.diagnostics.filter.all",
    search: "pluginSetting.diagnostics.filter.search",
    source: "pluginSetting.diagnostics.filter.source",
    lyric: "pluginSetting.diagnostics.filter.lyric",
    install: "pluginSetting.diagnostics.filter.install",
    other: "pluginSetting.diagnostics.filter.other",
};

function getKnownMethods() {
    return diagnosticFilterConfigs
        .flatMap(config => config.methods ?? [])
        .filter(Boolean);
}

function matchFilter(event: PluginDiagnosticEvent, filter: DiagnosticFilter) {
    if (filter === "all") {
        return true;
    }
    if (filter === "other") {
        return !getKnownMethods().includes(event.method);
    }
    const config = diagnosticFilterConfigs.find(item => item.key === filter);
    return !!config?.methods?.includes(event.method);
}

function formatDiagnosticTime(timestamp: number) {
    const date = new Date(timestamp);
    return [
        `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`,
        `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`,
    ].join(" ");
}

export default function PluginDiagnostics() {
    const { t } = useI18N();
    const colors = useColors();
    const plugins = useSortedPlugins();
    const [events, setEvents] = useState(() => getAllPluginDiagnosticEvents());
    const [filter, setFilter] = useState<DiagnosticFilter>("all");

    const filteredEvents = useMemo(
        () => events.filter(event => matchFilter(event, filter)),
        [events, filter],
    );

    function refreshDiagnostics() {
        setEvents(getAllPluginDiagnosticEvents());
    }

    function copyDiagnosticReport() {
        Clipboard.setString(buildPluginDiagnosticReport(plugins));
        Toast.success(t("toast.copiedToClipboard"));
    }

    return (
        <>
            <AppBar
                actions={[
                    {
                        icon: "arrow-path",
                        onPress: refreshDiagnostics,
                    },
                    {
                        icon: "document-outline",
                        onPress: copyDiagnosticReport,
                    },
                ]}>
                {t("pluginSetting.menu.diagnostics")}
            </AppBar>
            <HorizontalSafeAreaView style={styles.wrapper}>
                <View style={styles.summary}>
                    <ThemeText fontColor="textSecondary">
                        {t("pluginSetting.diagnostics.eventCount", {
                            count: filteredEvents.length,
                        })}
                    </ThemeText>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterBar}>
                    {diagnosticFilterConfigs.map(config => (
                        <FilterChip
                            key={config.key}
                            icon={config.icon}
                            title={t(diagnosticFilterI18nKeys[config.key])}
                            selected={filter === config.key}
                            onPress={() => setFilter(config.key)}
                        />
                    ))}
                </ScrollView>
                <FlatList
                    style={styles.list}
                    ListEmptyComponent={
                        <Empty content={t("pluginSetting.diagnostics.empty")} />
                    }
                    data={filteredEvents}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                        <DiagnosticEventItem event={item} />
                    )}
                    extraData={colors.text}
                />
            </HorizontalSafeAreaView>
        </>
    );
}

function FilterChip(props: {
    title: string;
    selected: boolean;
    onPress: () => void;
    icon: IIconName;
}) {
    const { title, selected, onPress, icon } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[
                styles.filterChip,
                {
                    backgroundColor: selected
                        ? Color(colors.primary).alpha(0.18).toString()
                        : colors.placeholder,
                    borderColor: selected
                        ? colors.primary
                        : Color(colors.text).alpha(0.06).toString(),
                },
            ]}
            onPress={onPress}>
            <Icon
                name={icon}
                size={rpx(28)}
                color={selected ? colors.primary : colors.text}
                style={styles.filterChipIcon}
            />
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontWeight="semibold"
                color={selected ? colors.primary : colors.text}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

function DiagnosticEventItem(props: { event: PluginDiagnosticEvent }) {
    const { event } = props;
    const colors = useColors();
    const { t } = useI18N();

    function copyDiagnosticEvent() {
        Clipboard.setString(buildPluginDiagnosticEventReport(event));
        Toast.success(t("toast.copiedToClipboard"));
    }

    return (
        <ListItem
            withHorizontalPadding
            heightType="none"
            style={styles.eventItem}>
            <ListItem.ListItemIcon
                icon="exclamation-circle"
                color={colors.textSecondary}
            />
            <View style={styles.eventContent}>
                <ThemeText numberOfLines={1} fontWeight="semibold">
                    {event.pluginName}
                </ThemeText>
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontColor="textSecondary"
                    style={styles.eventMeta}>
                    {`${event.method} · ${formatDiagnosticTime(event.createdAt)}`}
                </ThemeText>
                <ThemeText
                    numberOfLines={3}
                    fontSize="description"
                    style={styles.eventMessage}>
                    {event.message}
                </ThemeText>
                {event.estimatedLocation ? (
                    <ThemeText
                        numberOfLines={1}
                        fontSize="description"
                        fontColor="textSecondary"
                        style={styles.eventLocation}>
                        {event.estimatedLocation}
                    </ThemeText>
                ) : null}
            </View>
            <ListItem.ListItemIcon
                icon="document-outline"
                position="right"
                color={colors.textSecondary}
                onPress={copyDiagnosticEvent}
            />
        </ListItem>
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
    },
    filterBar: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    filterChip: {
        height: rpx(56),
        paddingHorizontal: rpx(18),
        borderRadius: rpx(28),
        borderWidth: StyleSheet.hairlineWidth,
        marginRight: rpx(12),
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
    },
    filterChipIcon: {
        marginRight: rpx(8),
    },
    list: {
        flex: 1,
    },
    eventItem: {
        minHeight: rpx(156),
        paddingVertical: rpx(18),
        alignItems: "flex-start",
    },
    eventContent: {
        flex: 1,
    },
    eventMeta: {
        marginTop: rpx(10),
    },
    eventMessage: {
        marginTop: rpx(12),
        lineHeight: rpx(34),
    },
    eventLocation: {
        marginTop: rpx(10),
    },
});
