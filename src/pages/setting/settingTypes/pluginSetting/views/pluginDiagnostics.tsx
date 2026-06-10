import React, { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useNavigation, useRoute } from "@react-navigation/native";
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
    clearPluginDiagnosticEvents,
    getAllPluginDiagnosticEvents,
    PluginDiagnosticEvent,
} from "@/core/pluginManager/diagnostics";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import type { ILanguageData } from "@/types/core/i18n";
import { showPanel } from "@/components/panels/usePanel";
import { showDialog } from "@/components/dialogs/useDialog";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { writePluginDiagnosticReport } from "../reportExportUtils";

type DiagnosticFilter = "all" | "search" | "source" | "lyric" | "install" | "other";
type DiagnosticTimeFilter = "all" | "today" | "last24h" | "last7d" | "last30d";

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

const diagnosticTimeFilterConfigs: Array<{
    key: DiagnosticTimeFilter;
    icon: IIconName;
}> = [
    {
        key: "all",
        icon: "clock-outline",
    },
    {
        key: "today",
        icon: "clock-outline",
    },
    {
        key: "last24h",
        icon: "clock-outline",
    },
    {
        key: "last7d",
        icon: "clock-outline",
    },
    {
        key: "last30d",
        icon: "clock-outline",
    },
];

const diagnosticTimeFilterI18nKeys: Record<
    DiagnosticTimeFilter,
    keyof ILanguageData
> = {
    all: "pluginSetting.diagnostics.timeFilter.all",
    today: "pluginSetting.diagnostics.timeFilter.today",
    last24h: "pluginSetting.diagnostics.timeFilter.last24h",
    last7d: "pluginSetting.diagnostics.timeFilter.last7d",
    last30d: "pluginSetting.diagnostics.timeFilter.last30d",
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

function getTodayStartTimestamp(now: number) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function getTimeFilterSince(timeFilter: DiagnosticTimeFilter, now: number) {
    if (timeFilter === "today") {
        return getTodayStartTimestamp(now);
    }
    if (timeFilter === "last24h") {
        return now - 24 * 60 * 60 * 1000;
    }
    if (timeFilter === "last7d") {
        return now - 7 * 24 * 60 * 60 * 1000;
    }
    if (timeFilter === "last30d") {
        return now - 30 * 24 * 60 * 60 * 1000;
    }
    return null;
}

function matchTimeFilter(
    event: PluginDiagnosticEvent,
    timeFilter: DiagnosticTimeFilter,
    now: number,
) {
    const since = getTimeFilterSince(timeFilter, now);
    return since === null || event.createdAt >= since;
}

function matchKeyword(event: PluginDiagnosticEvent, keyword: string) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
        return true;
    }
    return [
        event.pluginName,
        event.method,
        event.message,
        event.estimatedLocation ?? "",
    ].some(value => value.toLowerCase().includes(normalizedKeyword));
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
    const navigate = useNavigate();
    const route = useRoute<any>();
    const initialPluginName = `${route.params?.initialPluginName ?? ""}`.trim();
    const [events, setEvents] = useState(() => getAllPluginDiagnosticEvents());
    const [filter, setFilter] = useState<DiagnosticFilter>("all");
    const [pluginFilter, setPluginFilter] = useState(
        initialPluginName || "all",
    );
    const [timeFilter, setTimeFilter] = useState<DiagnosticTimeFilter>("all");
    const [keywordFilter, setKeywordFilter] = useState("");

    const filteredEvents = useMemo(() => {
        const now = Date.now();
        return events.filter(event => {
            if (!matchFilter(event, filter)) {
                return false;
            }
            if (!matchKeyword(event, keywordFilter)) {
                return false;
            }
            if (!matchTimeFilter(event, timeFilter, now)) {
                return false;
            }
            return (
                pluginFilter === "all" ||
                event.pluginName === pluginFilter
            );
        });
    }, [events, filter, pluginFilter, timeFilter, keywordFilter]);
    const pluginFilterItems = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    [
                        initialPluginName,
                        ...events.map(event => event.pluginName),
                    ].filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [events, initialPluginName],
    );
    const pluginFilterTitle =
        pluginFilter === "all"
            ? t("pluginSetting.diagnostics.pluginFilter.all")
            : pluginFilter;
    const keywordFilterTitle = keywordFilter.trim()
        ? `${t("pluginSetting.diagnostics.keywordFilter.title")}: ${keywordFilter.trim()}`
        : t("pluginSetting.diagnostics.keywordFilter.title");
    const timeFilterTitle =
        timeFilter === "all"
            ? t("pluginSetting.diagnostics.timeFilter.title")
            : t(diagnosticTimeFilterI18nKeys[timeFilter]);
    const activeFilterLabels = useMemo(
        () => [
            filter === "all"
                ? ""
                : t(diagnosticFilterI18nKeys[filter]),
            pluginFilter === "all" ? "" : pluginFilter,
            timeFilter === "all"
                ? ""
                : t(diagnosticTimeFilterI18nKeys[timeFilter]),
            keywordFilter.trim()
                ? `${t("pluginSetting.diagnostics.keywordFilter.title")}: ${keywordFilter.trim()}`
                : "",
        ].filter(Boolean),
        [filter, pluginFilter, timeFilter, keywordFilter, t],
    );
    const hasActiveFilters = activeFilterLabels.length > 0;
    const reportPlugins = useMemo(() => {
        if (!hasActiveFilters) {
            return plugins;
        }
        if (pluginFilter !== "all") {
            return plugins.filter(plugin => plugin.name === pluginFilter);
        }

        const eventPluginHashes = new Set(
            filteredEvents
                .map(event => event.pluginHash)
                .filter(Boolean),
        );
        const eventPluginNames = new Set(
            filteredEvents.map(event => event.pluginName),
        );

        return plugins.filter(plugin =>
            (plugin.hash && eventPluginHashes.has(plugin.hash)) ||
            eventPluginNames.has(plugin.name),
        );
    }, [filteredEvents, hasActiveFilters, pluginFilter, plugins]);

    useEffect(() => {
        if (initialPluginName) {
            setPluginFilter(initialPluginName);
        }
    }, [initialPluginName]);

    useEffect(() => {
        if (!pluginFilterItems.includes(pluginFilter)) {
            setPluginFilter("all");
        }
    }, [pluginFilter, pluginFilterItems]);

    function refreshDiagnostics() {
        setEvents(getAllPluginDiagnosticEvents());
    }

    function getPluginDiagnosticReportText() {
        if (hasActiveFilters) {
            return buildPluginDiagnosticReport(reportPlugins, {
                events: filteredEvents,
                filterSummary: activeFilterLabels.join(" / "),
            });
        }

        return buildPluginDiagnosticReport(plugins);
    }

    function copyDiagnosticReport() {
        Clipboard.setString(getPluginDiagnosticReportText());

        if (hasActiveFilters) {
            Toast.success(
                t("pluginSetting.diagnostics.copyFilteredReportSuccess", {
                    count: filteredEvents.length,
                }),
            );
            return;
        }

        Toast.success(t("toast.copiedToClipboard"));
    }

    function exportDiagnosticReport() {
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
                        getPluginDiagnosticReportText(),
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

    function clearFilteredDiagnostics() {
        showDialog("SimpleDialog", {
            title: t("pluginSetting.diagnostics.clearFiltered"),
            content: t("pluginSetting.diagnostics.clearFilteredConfirm", {
                count: filteredEvents.length,
            }),
            onOk() {
                const count = clearPluginDiagnosticEvents(
                    filteredEvents.map(event => event.id),
                );
                setEvents(getAllPluginDiagnosticEvents());
                if (count) {
                    Toast.success(t("pluginSetting.diagnostics.clearSuccess", {
                        count,
                    }));
                }
            },
        });
    }

    function showPluginFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("pluginSetting.diagnostics.pluginFilter.title"),
            candidates: pluginFilterItems.map(pluginName => ({
                title:
                    pluginName === "all"
                        ? t("pluginSetting.diagnostics.pluginFilter.all")
                        : pluginName,
                value: pluginName,
                icon:
                    pluginName === "all"
                        ? "document-outline"
                        : "javascript",
            })),
            onPress(item) {
                setPluginFilter(item.value);
            },
        });
    }

    function showTimeFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("pluginSetting.diagnostics.timeFilter.title"),
            candidates: diagnosticTimeFilterConfigs.map(config => ({
                title: t(diagnosticTimeFilterI18nKeys[config.key]),
                value: config.key,
                icon: config.icon,
            })),
            onPress(item) {
                setTimeFilter(item.value as DiagnosticTimeFilter);
            },
        });
    }

    function showKeywordFilterInput() {
        showPanel("SimpleInput", {
            title: t("pluginSetting.diagnostics.keywordFilter.title"),
            placeholder: t(
                "pluginSetting.diagnostics.keywordFilter.placeholder",
            ),
            maxLength: 80,
            async onOk(text, closePanel) {
                setKeywordFilter(text.trim());
                closePanel();
            },
        });
    }

    function clearFilters() {
        setFilter("all");
        setPluginFilter("all");
        setTimeFilter("all");
        setKeywordFilter("");
    }

    return (
        <>
            <AppBar
                actions={[
                    {
                        icon: "arrow-path",
                        onPress: refreshDiagnostics,
                    },
                    ...(
                        filteredEvents.length
                            ? [{
                                icon: "trash-outline" as const,
                                onPress: clearFilteredDiagnostics,
                            }]
                            : []
                    ),
                    {
                        icon: "document-outline",
                        onPress: copyDiagnosticReport,
                    },
                    {
                        icon: "arrow-up-tray",
                        onPress: exportDiagnosticReport,
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
                    {hasActiveFilters ? (
                        <ThemeText
                            fontColor="textSecondary"
                            fontSize="description"
                            style={styles.filterSummary}>
                            {t("pluginSetting.diagnostics.activeFilters", {
                                filters: activeFilterLabels.join(" / "),
                            })}
                        </ThemeText>
                    ) : null}
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
                    <FilterChip
                        icon="javascript"
                        title={pluginFilterTitle}
                        selected={pluginFilter !== "all"}
                        onPress={showPluginFilterSelect}
                    />
                    <FilterChip
                        icon="clock-outline"
                        title={timeFilterTitle}
                        selected={timeFilter !== "all"}
                        onPress={showTimeFilterSelect}
                    />
                    <FilterChip
                        icon="magnifying-glass"
                        title={keywordFilterTitle}
                        selected={Boolean(keywordFilter.trim())}
                        onPress={showKeywordFilterInput}
                    />
                    {hasActiveFilters ? (
                        <FilterChip
                            icon="x-mark"
                            title={t("common.clear")}
                            selected={false}
                            onPress={clearFilters}
                        />
                    ) : null}
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
    const navigate = useNavigate();
    const navigator = useNavigation<any>();

    function getDiagnosticEventReport() {
        return buildPluginDiagnosticEventReport(event);
    }

    function copyDiagnosticEvent() {
        Clipboard.setString(getDiagnosticEventReport());
        Toast.success(t("toast.copiedToClipboard"));
    }

    function showDiagnosticEventDetail() {
        const reportText = getDiagnosticEventReport();
        showDialog("SimpleDialog", {
            title: t("pluginSetting.diagnostics.eventDetailTitle", {
                name: event.pluginName,
            }),
            content: reportText,
            okText: t("pluginSetting.diagnostics.copyEventReport"),
            cancelText: t("pluginSetting.diagnostics.viewPlugin"),
            onCancel() {
                navigator.navigate("/pluginsetting/list", {
                    initialPluginName: event.pluginName,
                });
            },
            onOk() {
                Clipboard.setString(reportText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    function exportDiagnosticEvent() {
        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("pluginSetting.diagnostics.exportEventAction"),
            async onAction(selectedFiles) {
                const folder = selectedFiles[0]?.path;
                if (!folder) {
                    return false;
                }
                try {
                    const filename = await writePluginDiagnosticReport(
                        folder,
                        getDiagnosticEventReport(),
                    );
                    Toast.success(t(
                        "pluginSetting.diagnostics.exportEventSuccess",
                        { filename },
                    ));
                    return true;
                } catch (e: any) {
                    Toast.warn(t(
                        "pluginSetting.diagnostics.exportEventFailed",
                        { reason: e?.message ?? e },
                    ));
                    return false;
                }
            },
        });
    }

    return (
        <ListItem
            withHorizontalPadding
            heightType="none"
            onPress={showDiagnosticEventDetail}
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
            <ListItem.ListItemIcon
                icon="arrow-up-tray"
                position="right"
                color={colors.textSecondary}
                onPress={exportDiagnosticEvent}
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
    filterSummary: {
        marginTop: rpx(8),
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
