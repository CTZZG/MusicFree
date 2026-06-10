import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ListItem from "@/components/base/listItem";
import { sizeFormatter } from "@/utils/fileUtils";
import downloader, {
    DownloadFailReason,
    DownloadStatus,
    useDownloadQueue,
    useDownloadTasksSnapshot,
    useDownloadTask,
} from "@/core/downloader";
import { FlashList } from "@shopify/flash-list";
import { useI18N } from "@/core/i18n";
import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import Color from "color";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import ListEmpty from "@/components/base/listEmpty";
import { RequestStateCode } from "@/constants/commonConst";
import { showPanel } from "@/components/panels/usePanel";
import Icon, { IIconName } from "@/components/base/icon";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";

type DownloadFilter = "all" | "active" | "paused" | "completed" | "error";

interface DownloadingListItemProps {
    musicItem: IMusic.IMusicItem;
}
function DownloadingListItem(props: DownloadingListItemProps) {
    const { musicItem } = props;
    const taskInfo = useDownloadTask(musicItem);
    const { t } = useI18N();

    const status = taskInfo?.status ?? DownloadStatus.Error;

    let description = "";

    if (status === DownloadStatus.Error) {
        const reason = taskInfo?.errorReason;

        if (reason === DownloadFailReason.NoWritePermission) {
            description = t("downloading.downloadFailReason.noWritePermission");
        } else if (reason === DownloadFailReason.FailToFetchSource) {
            description = t("downloading.downloadFailReason.failToFetchSource");
        } else if (reason === DownloadFailReason.EncryptedMediaUnsupported) {
            description = t("downloading.downloadFailReason.encryptedMediaUnsupported");
        } else if (reason === DownloadFailReason.Interrupted) {
            description = t("downloading.downloadFailReason.interrupted");
        } else {
            description = t("downloading.downloadFailReason.unknown");
        }
    } else if (status === DownloadStatus.Completed) {
        description = taskInfo?.completedAt
            ? t("downloading.downloadStatus.completedAt", {
                time: formatDownloadCompletedAt(taskInfo.completedAt),
            })
            : t("downloading.downloadStatus.completed");
    } else if (status === DownloadStatus.Downloading) {
        const progress = taskInfo?.downloadedSize ? sizeFormatter(taskInfo.downloadedSize) : "-";
        const totalSize = taskInfo?.fileSize ? sizeFormatter(taskInfo.fileSize) : "-";

        description = taskInfo?.progressText || t("downloading.downloadStatus.downloadProgress", {
            progress,
            totalSize,
        });
    } else if (status === DownloadStatus.Pending) {
        description = t("downloading.downloadStatus.pending");
    } else if (status === DownloadStatus.Preparing) {
        description = t("downloading.downloadStatus.preparing");
    } else if (status === DownloadStatus.Paused) {
        description = t("downloading.downloadStatus.paused");
    }

    const canUseNativeControls = downloader.isNativeDownloadControlAvailable();
    const canPause =
        canUseNativeControls && status === DownloadStatus.Downloading;
    const canResume = canUseNativeControls && status === DownloadStatus.Paused;
    const canRetry = status === DownloadStatus.Error;
    const canRemove = status !== DownloadStatus.Completed;

    return <ListItem withHorizontalPadding rightPadding={rpx(4)}>
        <ListItem.Content
            title={musicItem.title}
            description={description}
        />
        {canRetry ? (
            <ListItem.ListItemIcon
                icon="arrow-path"
                position="right"
                onPress={() => downloader.retry(musicItem)}
            />
        ) : null}
        {canPause ? (
            <ListItem.ListItemIcon
                icon="pause"
                position="right"
                onPress={() => {
                    void downloader.pause(musicItem);
                }}
            />
        ) : null}
        {canResume ? (
            <ListItem.ListItemIcon
                icon="play"
                position="right"
                onPress={() => {
                    void downloader.resume(musicItem);
                }}
            />
        ) : null}
        {canRemove ? (
            <ListItem.ListItemIcon
                icon="trash-outline"
                position="right"
                onPress={() => downloader.remove(musicItem)}
            />
        ) : null}
    </ListItem>;

}

function isActiveStatus(status: DownloadStatus) {
    return (
        status === DownloadStatus.Pending ||
        status === DownloadStatus.Preparing ||
        status === DownloadStatus.Downloading
    );
}

function matchDownloadFilter(status: DownloadStatus, filter: DownloadFilter) {
    if (filter === "all") {
        return true;
    }
    if (filter === "active") {
        return isActiveStatus(status);
    }
    if (filter === "paused") {
        return status === DownloadStatus.Paused;
    }
    if (filter === "completed") {
        return status === DownloadStatus.Completed;
    }
    if (filter === "error") {
        return status === DownloadStatus.Error;
    }
    return true;
}

function padTime(value: number) {
    return `${value}`.padStart(2, "0");
}

function formatDownloadCompletedAt(timestamp: number) {
    const date = new Date(timestamp);
    return [
        `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(
            date.getDate(),
        )}`,
        `${padTime(date.getHours())}:${padTime(date.getMinutes())}`,
    ].join(" ");
}

function FilterChip(props: {
    title: string;
    selected: boolean;
    onPress: () => void;
    icon?: IIconName;
}) {
    const { title, selected, onPress, icon } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[
                style.filterChip,
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
            <View style={style.filterChipContent}>
                {icon ? (
                    <Icon
                        name={icon}
                        size={rpx(28)}
                        color={selected ? colors.primary : colors.text}
                        style={style.filterChipIcon}
                    />
                ) : null}
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontWeight="semibold"
                    color={selected ? colors.primary : colors.text}>
                    {title}
                </ThemeText>
            </View>
        </Pressable>
    );
}

export default function DownloadingList() {
    const downloadQueue = useDownloadQueue();
    const downloadTasks = useDownloadTasksSnapshot();
    const { t } = useI18N();
    const [filter, setFilter] = useState<DownloadFilter>("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const canUseNativeControls = downloader.isNativeDownloadControlAvailable();

    const filterItems: Array<{
        key: DownloadFilter;
        title: string;
    }> = [
        {
            key: "all",
            title: t("downloading.filter.all"),
        },
        {
            key: "active",
            title: t("downloading.filter.active"),
        },
        {
            key: "paused",
            title: t("downloading.filter.paused"),
        },
        {
            key: "completed",
            title: t("downloading.filter.completed"),
        },
        {
            key: "error",
            title: t("downloading.filter.error"),
        },
    ];

    const sourceFilters = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    downloadQueue
                        .map(musicItem => musicItem.platform)
                        .filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [downloadQueue],
    );
    const sourceFilterTitle =
        sourceFilter === "all"
            ? t("downloading.sourceFilter.all")
            : sourceFilter;
    const completedDownloadItems = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (status !== DownloadStatus.Completed) {
                    return false;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter],
    );
    const completedTaskCount = completedDownloadItems.length;
    const failedDownloadItems = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (status !== DownloadStatus.Error) {
                    return false;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter],
    );
    const failedTaskCount = failedDownloadItems.length;
    const pausableDownloadItems = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (
                    status !== DownloadStatus.Preparing &&
                    status !== DownloadStatus.Downloading
                ) {
                    return false;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter],
    );
    const resumableDownloadItems = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (status !== DownloadStatus.Paused) {
                    return false;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter],
    );

    useEffect(() => {
        if (!sourceFilters.includes(sourceFilter)) {
            setSourceFilter("all");
        }
    }, [sourceFilter, sourceFilters]);

    function showSourceFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.sourceFilter.title"),
            candidates: sourceFilters.map(source => ({
                title:
                    source === "all"
                        ? t("downloading.sourceFilter.all")
                        : source,
                value: source,
            })),
            onPress(item) {
                setSourceFilter(item.value);
            },
        });
    }

    function clearCompletedTasks() {
        showDialog("SimpleDialog", {
            title: t("downloading.clearCompleted"),
            content: t("downloading.clearCompletedConfirm", {
                count: completedTaskCount,
            }),
            onOk() {
                const count = downloader.clearCompletedTasks(
                    completedDownloadItems,
                );
                if (count) {
                    Toast.success(t("downloading.clearCompletedSuccess", {
                        count,
                    }));
                }
            },
        });
    }

    function retryFailedTasks() {
        const count = downloader.retryFailedTasks(failedDownloadItems);
        if (count) {
            Toast.success(t("downloading.retryFailedSuccess", { count }));
        }
    }

    function clearFailedTasks() {
        showDialog("SimpleDialog", {
            title: t("downloading.clearFailed"),
            content: t("downloading.clearFailedConfirm", {
                count: failedTaskCount,
            }),
            onOk() {
                const count = downloader.clearFailedTasks(failedDownloadItems);
                if (count) {
                    Toast.success(t("downloading.clearFailedSuccess", {
                        count,
                    }));
                }
            },
        });
    }

    async function pauseActiveTasks() {
        const count = await downloader.pauseTasks(pausableDownloadItems);
        if (count) {
            Toast.success(t("downloading.pauseActiveSuccess", { count }));
        }
    }

    async function resumePausedTasks() {
        const count = await downloader.resumeTasks(resumableDownloadItems);
        if (count) {
            Toast.success(t("downloading.resumePausedSuccess", { count }));
        }
    }

    const filteredQueue = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (!matchDownloadFilter(status, filter)) {
                    return false;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, filter, sourceFilter],
    );


    return (
        <View style={style.wrapper}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={style.filterBar}>
                {filterItems.map(item => (
                    <FilterChip
                        key={item.key}
                        title={item.title}
                        selected={filter === item.key}
                        onPress={() => setFilter(item.key)}
                    />
                ))}
                <FilterChip
                    title={sourceFilterTitle}
                    selected={sourceFilter !== "all"}
                    onPress={showSourceFilterSelect}
                    icon="code-bracket-square"
                />
                {canUseNativeControls && pausableDownloadItems.length ? (
                    <FilterChip
                        title={t("downloading.pauseActive")}
                        selected={false}
                        onPress={pauseActiveTasks}
                        icon="pause"
                    />
                ) : null}
                {canUseNativeControls && resumableDownloadItems.length ? (
                    <FilterChip
                        title={t("downloading.resumePaused")}
                        selected={false}
                        onPress={resumePausedTasks}
                        icon="play"
                    />
                ) : null}
                {completedTaskCount ? (
                    <FilterChip
                        title={t("downloading.clearCompleted")}
                        selected={false}
                        onPress={clearCompletedTasks}
                        icon="trash-outline"
                    />
                ) : null}
                {failedTaskCount ? (
                    <>
                        <FilterChip
                            title={t("downloading.retryFailed")}
                            selected={false}
                            onPress={retryFailedTasks}
                            icon="arrow-path"
                        />
                        <FilterChip
                            title={t("downloading.clearFailed")}
                            selected={false}
                            onPress={clearFailedTasks}
                            icon="trash-outline"
                        />
                    </>
                ) : null}
            </ScrollView>
            <FlashList
                style={style.downloading}
                ListEmptyComponent={
                    <ListEmpty state={RequestStateCode.IDLE} />
                }
                data={filteredQueue}
                keyExtractor={_ => `dl${_.platform}.${_.id}`}
                renderItem={({ item }) => {
                    return <DownloadingListItem musicItem={item} />;
                }}
            />
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
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
    },
    filterChipContent: {
        flexDirection: "row",
        alignItems: "center",
    },
    filterChipIcon: {
        marginRight: rpx(8),
    },
    downloading: {
        flexGrow: 0,
    },
});
