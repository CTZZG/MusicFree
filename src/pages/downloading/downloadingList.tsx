import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { writeFile } from "react-native-fs";
import rpx from "@/utils/rpx";
import ListItem from "@/components/base/listItem";
import {
    getDirectory,
    removeFileScheme,
    sizeFormatter,
} from "@/utils/fileUtils";
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
import { getLocalPath, getMediaUniqueKey } from "@/utils/mediaUtils";
import ListEmpty from "@/components/base/listEmpty";
import { RequestStateCode } from "@/constants/commonConst";
import { showPanel } from "@/components/panels/usePanel";
import Icon, { IIconName } from "@/components/base/icon";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import {
    getMediaExtraProperty,
    useMediaExtraProperty,
    useMediaExtraVersion,
} from "@/utils/mediaExtra";

type DownloadFilter = "all" | "active" | "paused" | "completed" | "error";
type DownloadWriteFilter =
    | "all"
    | "metadata-success"
    | "metadata-failed"
    | "metadata-skipped"
    | "lyric-success"
    | "lyric-failed";
type DownloadSortMode =
    | "default"
    | "completed-newest"
    | "completed-oldest"
    | "title"
    | "artist";
type DownloadWriteStatus = "success" | "failed" | "skipped";
type DownloadWriteStatusStats = Record<DownloadWriteStatus | "pending", number>;
type DownloadTaskDetailInfo = {
    filename?: string;
    completedAt?: number;
};

function createDownloadWriteStatusStats(): DownloadWriteStatusStats {
    return {
        success: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
    };
}

function addDownloadWriteStatusStats(
    stats: DownloadWriteStatusStats,
    status: DownloadWriteStatus | null,
) {
    if (status) {
        stats[status] += 1;
    } else {
        stats.pending += 1;
    }
}

function getCompletedDownloadRecordStats(items: IMusic.IMusicItem[]) {
    const metadata = createDownloadWriteStatusStats();
    const lyric = createDownloadWriteStatusStats();
    items.forEach(musicItem => {
        addDownloadWriteStatusStats(
            metadata,
            getDownloadWriteStatus(musicItem, "downloadMetadataStatus"),
        );
        addDownloadWriteStatusStats(
            lyric,
            getDownloadWriteStatus(musicItem, "downloadLyricStatus"),
        );
    });
    return { metadata, lyric };
}

function getDownloadReportFileName() {
    const date = new Date();
    return [
        "MusicFree-download-records",
        date.getFullYear(),
        padTime(date.getMonth() + 1),
        padTime(date.getDate()),
        padTime(date.getHours()),
        padTime(date.getMinutes()),
        padTime(date.getSeconds()),
    ].join("-") + ".txt";
}

function joinFolderPath(folder: string, filename: string) {
    return `${folder.replace(/[\\/]+$/, "")}/${filename}`;
}

function getCompletedDownloadLocalPath(musicItem: IMusic.IMusicItem) {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return null;
    }
    return removeFileScheme(localPath) || null;
}

function getCompletedDownloadFolderPath(filePath: string | null) {
    if (!filePath) {
        return null;
    }
    const directory = getDirectory(filePath);
    return directory && directory !== filePath ? directory : null;
}

function getCompletedDownloadDetailText(
    musicItem: IMusic.IMusicItem,
    taskInfo: DownloadTaskDetailInfo | null | undefined,
    downloadMetadataStatus: DownloadWriteStatus | null,
    downloadLyricStatus: DownloadWriteStatus | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    return [
        `${t("downloading.detail.song")}: ${musicItem.title || t("common.unknownName")}`,
        `${t("downloading.detail.artist")}: ${musicItem.artist || t("common.unknownName")}`,
        `${t("downloading.detail.source")}: ${musicItem.platform || "-"}`,
        `${t("downloading.detail.completedAt")}: ${
            taskInfo?.completedAt
                ? formatDownloadCompletedAt(taskInfo.completedAt)
                : "-"
        }`,
        `${t("downloading.detail.fileName")}: ${taskInfo?.filename || "-"}`,
        `${t("downloading.detail.metadataStatus")}: ${getDownloadDetailMetadataStatusText(
            downloadMetadataStatus,
            t,
        )}`,
        `${t("downloading.detail.lyricStatus")}: ${getDownloadDetailLyricStatusText(
            downloadLyricStatus,
            t,
        )}`,
    ].join("\n");
}

function buildCompletedDownloadRecordsReport(params: {
    items: IMusic.IMusicItem[];
    downloadTasks: ReadonlyMap<string, DownloadTaskDetailInfo>;
    statusFilterTitle: string;
    sourceFilterTitle: string;
    writeFilterTitle: string;
    sortTitle: string;
    t: ReturnType<typeof useI18N>["t"];
}) {
    const {
        items,
        downloadTasks,
        statusFilterTitle,
        sourceFilterTitle,
        writeFilterTitle,
        sortTitle,
        t,
    } = params;
    const stats = getCompletedDownloadRecordStats(items);
    const records = items.map((musicItem, index) => [
        `#${index + 1}`,
        getCompletedDownloadDetailText(
            musicItem,
            downloadTasks.get(getMediaUniqueKey(musicItem)),
            getDownloadWriteStatus(musicItem, "downloadMetadataStatus"),
            getDownloadWriteStatus(musicItem, "downloadLyricStatus"),
            t,
        ),
    ].join("\n"));

    return [
        t("downloading.report.title"),
        `${t("downloading.report.generatedAt")}: ${new Date().toISOString()}`,
        `${t("downloading.report.count")}: ${items.length}`,
        t("downloading.report.metadataSummary", stats.metadata),
        t("downloading.report.lyricSummary", stats.lyric),
        `${t("downloading.report.filterStatus")}: ${statusFilterTitle}`,
        `${t("downloading.report.filterSource")}: ${sourceFilterTitle}`,
        `${t("downloading.report.filterWrite")}: ${writeFilterTitle}`,
        `${t("downloading.report.sort")}: ${sortTitle}`,
        "",
        records.join("\n\n"),
    ].join("\n");
}

interface DownloadingListItemProps {
    musicItem: IMusic.IMusicItem;
}
function DownloadingListItem(props: DownloadingListItemProps) {
    const { musicItem } = props;
    const taskInfo = useDownloadTask(musicItem);
    const { t } = useI18N();
    const colors = useColors();
    const downloadMetadataStatus = useMediaExtraProperty(
        musicItem,
        "downloadMetadataStatus",
    ) as DownloadWriteStatus | null;
    const downloadLyricStatus = useMediaExtraProperty(
        musicItem,
        "downloadLyricStatus",
    ) as DownloadWriteStatus | null;

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
        const completedText = taskInfo?.completedAt
            ? t("downloading.downloadStatus.completedAt", {
                time: formatDownloadCompletedAt(taskInfo.completedAt),
            })
            : t("downloading.downloadStatus.completed");
        description = [
            completedText,
            getDownloadMetadataStatusText(downloadMetadataStatus, t),
            getDownloadLyricStatusText(downloadLyricStatus, t),
        ].filter(Boolean).join(" · ");
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

    function showCompletedDownloadDetail() {
        if (status !== DownloadStatus.Completed) {
            return;
        }
        const detailText = getCompletedDownloadDetailText(
            musicItem,
            taskInfo,
            downloadMetadataStatus,
            downloadLyricStatus,
            t,
        );
        const filePath = getCompletedDownloadLocalPath(musicItem);
        const folderPath = getCompletedDownloadFolderPath(filePath);

        function copyDetailValue(value: string, successText: string) {
            Clipboard.setString(value);
            Toast.success(successText);
        }

        showDialog("SimpleDialog", {
            title: t("downloading.detail.title"),
            content: (
                <View style={style.detailContent}>
                    <ThemeText
                        selectable
                        fontSize="content"
                        style={style.detailText}>
                        {detailText}
                    </ThemeText>
                    {filePath ? (
                        <View style={style.detailPathActions}>
                            {folderPath ? (
                                <Pressable
                                    style={[
                                        style.detailPathAction,
                                        { backgroundColor: colors.placeholder },
                                    ]}
                                    onPress={() =>
                                        copyDetailValue(
                                            folderPath,
                                            t("downloading.detail.copyFolderPathSuccess"),
                                        )
                                    }>
                                    <Icon
                                        name="folder-outline"
                                        size={rpx(28)}
                                        color={colors.text}
                                    />
                                    <ThemeText
                                        numberOfLines={1}
                                        fontSize="description"
                                        fontWeight="semibold">
                                        {t("downloading.detail.copyFolderPath")}
                                    </ThemeText>
                                </Pressable>
                            ) : null}
                            <Pressable
                                style={[
                                    style.detailPathAction,
                                    { backgroundColor: colors.placeholder },
                                ]}
                                onPress={() =>
                                    copyDetailValue(
                                        filePath,
                                        t("downloading.detail.copyFilePathSuccess"),
                                    )
                                }>
                                <Icon
                                    name="document-outline"
                                    size={rpx(28)}
                                    color={colors.text}
                                />
                                <ThemeText
                                    numberOfLines={1}
                                    fontSize="description"
                                    fontWeight="semibold">
                                    {t("downloading.detail.copyFilePath")}
                                </ThemeText>
                            </Pressable>
                        </View>
                    ) : (
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary">
                            {t("downloading.detail.filePathUnavailable")}
                        </ThemeText>
                    )}
                </View>
            ),
            okText: t("downloading.detail.copy"),
            cancelText: t("downloading.detail.close"),
            onOk() {
                Clipboard.setString(detailText);
                Toast.success(t("toast.copiedToClipboard"));
            },
        });
    }

    return <ListItem
        withHorizontalPadding
        rightPadding={rpx(4)}
        onPress={
            status === DownloadStatus.Completed
                ? showCompletedDownloadDetail
                : undefined
        }>
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

function getDownloadWriteStatus(
    musicItem: IMusic.IMusicItem,
    key: "downloadMetadataStatus" | "downloadLyricStatus",
) {
    return getMediaExtraProperty(musicItem, key) as DownloadWriteStatus | null;
}

function matchDownloadWriteFilter(
    musicItem: IMusic.IMusicItem,
    status: DownloadStatus,
    filter: DownloadWriteFilter,
) {
    if (filter === "all") {
        return true;
    }
    if (status !== DownloadStatus.Completed) {
        return false;
    }

    if (filter === "metadata-success") {
        return getDownloadWriteStatus(musicItem, "downloadMetadataStatus") ===
            "success";
    }
    if (filter === "metadata-failed") {
        return getDownloadWriteStatus(musicItem, "downloadMetadataStatus") ===
            "failed";
    }
    if (filter === "metadata-skipped") {
        return getDownloadWriteStatus(musicItem, "downloadMetadataStatus") ===
            "skipped";
    }
    if (filter === "lyric-success") {
        return getDownloadWriteStatus(musicItem, "downloadLyricStatus") ===
            "success";
    }
    if (filter === "lyric-failed") {
        return getDownloadWriteStatus(musicItem, "downloadLyricStatus") ===
            "failed";
    }
    return true;
}

function getDownloadTaskCompletedAt(
    downloadTasks: Map<string, { completedAt?: number }>,
    musicItem: IMusic.IMusicItem,
) {
    return downloadTasks.get(getMediaUniqueKey(musicItem))?.completedAt ?? 0;
}

function compareText(left?: string, right?: string) {
    return (left ?? "").localeCompare(right ?? "");
}

function sortDownloadItems(
    items: IMusic.IMusicItem[],
    downloadTasks: Map<string, { completedAt?: number }>,
    sortMode: DownloadSortMode,
) {
    if (sortMode === "default") {
        return items;
    }

    return [...items].sort((a, b) => {
        if (sortMode === "completed-newest") {
            return (
                getDownloadTaskCompletedAt(downloadTasks, b) -
                    getDownloadTaskCompletedAt(downloadTasks, a) ||
                compareText(a.title, b.title)
            );
        }
        if (sortMode === "completed-oldest") {
            return (
                (getDownloadTaskCompletedAt(downloadTasks, a) ||
                    Number.MAX_SAFE_INTEGER) -
                    (getDownloadTaskCompletedAt(downloadTasks, b) ||
                        Number.MAX_SAFE_INTEGER) ||
                compareText(a.title, b.title)
            );
        }
        if (sortMode === "title") {
            return compareText(a.title, b.title);
        }
        if (sortMode === "artist") {
            return (
                compareText(a.artist, b.artist) ||
                compareText(a.title, b.title)
            );
        }
        return 0;
    });
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

function getDownloadMetadataStatusText(
    status: DownloadWriteStatus | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (!status) {
        return "";
    }
    if (status === "success") {
        return t("localMusic.metadataStatus.success");
    }
    if (status === "failed") {
        return t("localMusic.metadataStatus.failed");
    }
    return t("localMusic.metadataStatus.skipped");
}

function getDownloadLyricStatusText(
    status: DownloadWriteStatus | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (!status || status === "skipped") {
        return "";
    }
    return status === "success"
        ? t("localMusic.lyricFileStatus.success")
        : t("localMusic.lyricFileStatus.failed");
}

function getDownloadDetailMetadataStatusText(
    status: DownloadWriteStatus | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    return status
        ? getDownloadMetadataStatusText(status, t)
        : t("downloading.detail.pendingWriteStatus");
}

function getDownloadDetailLyricStatusText(
    status: DownloadWriteStatus | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (!status) {
        return t("downloading.detail.pendingWriteStatus");
    }
    if (status === "skipped") {
        return t("downloading.detail.lyricSkipped");
    }
    return getDownloadLyricStatusText(status, t);
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
    const navigate = useNavigate();
    const [filter, setFilter] = useState<DownloadFilter>("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [writeFilter, setWriteFilter] = useState<DownloadWriteFilter>("all");
    const [sortMode, setSortMode] = useState<DownloadSortMode>("default");
    const mediaExtraVersion = useMediaExtraVersion();
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
    const statusFilterTitle =
        filterItems.find(item => item.key === filter)?.title ??
        t("downloading.filter.all");

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
    const writeFilterItems: Array<{
        key: DownloadWriteFilter;
        title: string;
    }> = [
        {
            key: "all",
            title: t("downloading.writeStatusFilter.all"),
        },
        {
            key: "metadata-success",
            title: t("downloading.writeStatusFilter.metadataSuccess"),
        },
        {
            key: "metadata-failed",
            title: t("downloading.writeStatusFilter.metadataFailed"),
        },
        {
            key: "metadata-skipped",
            title: t("downloading.writeStatusFilter.metadataSkipped"),
        },
        {
            key: "lyric-success",
            title: t("downloading.writeStatusFilter.lyricSuccess"),
        },
        {
            key: "lyric-failed",
            title: t("downloading.writeStatusFilter.lyricFailed"),
        },
    ];
    const writeFilterTitle =
        writeFilter === "all"
            ? t("downloading.writeStatusFilter.title")
            : writeFilterItems.find(item => item.key === writeFilter)?.title ??
                t("downloading.writeStatusFilter.title");
    const writeFilterReportTitle =
        writeFilterItems.find(item => item.key === writeFilter)?.title ??
        t("downloading.writeStatusFilter.all");
    const sortItems: Array<{
        key: DownloadSortMode;
        title: string;
    }> = [
        {
            key: "default",
            title: t("downloading.sort.default"),
        },
        {
            key: "completed-newest",
            title: t("downloading.sort.completedNewest"),
        },
        {
            key: "completed-oldest",
            title: t("downloading.sort.completedOldest"),
        },
        {
            key: "title",
            title: t("downloading.sort.titleName"),
        },
        {
            key: "artist",
            title: t("downloading.sort.artistName"),
        },
    ];
    const sortTitle =
        sortMode === "default"
            ? t("downloading.sort.title")
            : sortItems.find(item => item.key === sortMode)?.title ??
                t("downloading.sort.title");
    const sortReportTitle =
        sortItems.find(item => item.key === sortMode)?.title ??
        t("downloading.sort.default");
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
                if (!matchDownloadWriteFilter(musicItem, status, writeFilter)) {
                    return false;
                }
                return true;
            }),
        [
            downloadQueue,
            downloadTasks,
            sourceFilter,
            writeFilter,
            mediaExtraVersion,
        ],
    );
    const completedTaskCount = completedDownloadItems.length;
    const completedWriteStats = useMemo(
        () => {
            const stats = {
                completed: 0,
                metadataFailed: 0,
                lyricFailed: 0,
            };
            downloadQueue.forEach(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (status !== DownloadStatus.Completed) {
                    return;
                }
                if (
                    sourceFilter !== "all" &&
                    musicItem.platform !== sourceFilter
                ) {
                    return;
                }
                stats.completed += 1;
                if (
                    getDownloadWriteStatus(
                        musicItem,
                        "downloadMetadataStatus",
                    ) === "failed"
                ) {
                    stats.metadataFailed += 1;
                }
                if (
                    getDownloadWriteStatus(musicItem, "downloadLyricStatus") ===
                    "failed"
                ) {
                    stats.lyricFailed += 1;
                }
            });
            return stats;
        },
        [downloadQueue, downloadTasks, sourceFilter, mediaExtraVersion],
    );
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

    function showWriteFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.writeStatusFilter.title"),
            candidates: writeFilterItems.map(item => ({
                title: item.title,
                value: item.key,
                icon: "save-outline",
            })),
            onPress(item) {
                setWriteFilter(item.value as DownloadWriteFilter);
            },
        });
    }

    function showSortSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.sort.title"),
            candidates: sortItems.map(item => ({
                title: item.title,
                value: item.key,
                icon: "sort-outline",
            })),
            onPress(item) {
                setSortMode(item.value as DownloadSortMode);
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
                } else {
                    showNoBatchTasksToast();
                }
            },
        });
    }

    function showNoBatchTasksToast() {
        Toast.warn(t("downloading.batchActionNoTasks"));
    }

    function retryFailedTasks() {
        const count = downloader.retryFailedTasks(failedDownloadItems);
        if (count) {
            Toast.success(t("downloading.retryFailedSuccess", { count }));
        } else {
            showNoBatchTasksToast();
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
                } else {
                    showNoBatchTasksToast();
                }
            },
        });
    }

    async function pauseActiveTasks() {
        const count = await downloader.pauseTasks(pausableDownloadItems);
        if (count) {
            Toast.success(t("downloading.pauseActiveSuccess", { count }));
        } else {
            showNoBatchTasksToast();
        }
    }

    async function resumePausedTasks() {
        const count = await downloader.resumeTasks(resumableDownloadItems);
        if (count) {
            Toast.success(t("downloading.resumePausedSuccess", { count }));
        } else {
            showNoBatchTasksToast();
        }
    }

    const filteredQueue = useMemo(
        () => {
            const items = downloadQueue.filter(musicItem => {
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
                if (!matchDownloadWriteFilter(musicItem, status, writeFilter)) {
                    return false;
                }
                return true;
            });
            return sortDownloadItems(items, downloadTasks, sortMode);
        },
        [
            downloadQueue,
            downloadTasks,
            filter,
            sourceFilter,
            writeFilter,
            sortMode,
            mediaExtraVersion,
        ],
    );
    const completedFilteredQueue = useMemo(
        () =>
            filteredQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                return status === DownloadStatus.Completed;
            }),
        [filteredQueue, downloadTasks],
    );

    function copyCompletedDownloadRecords() {
        if (!completedFilteredQueue.length) {
            showNoBatchTasksToast();
            return;
        }

        Clipboard.setString(getCompletedDownloadReportText());
        Toast.success(t("downloading.copyCompletedRecordsSuccess", {
            count: completedFilteredQueue.length,
        }));
    }

    function getCompletedDownloadReportText() {
        return buildCompletedDownloadRecordsReport({
            items: completedFilteredQueue,
            downloadTasks,
            statusFilterTitle,
            sourceFilterTitle,
            writeFilterTitle: writeFilterReportTitle,
            sortTitle: sortReportTitle,
            t,
        });
    }

    function exportCompletedDownloadRecords() {
        if (!completedFilteredQueue.length) {
            showNoBatchTasksToast();
            return;
        }

        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("downloading.exportCompletedRecordsAction"),
            async onAction(selectedFiles) {
                const folder = selectedFiles[0]?.path;
                if (!folder) {
                    return false;
                }
                const filename = getDownloadReportFileName();
                try {
                    await writeFile(
                        joinFolderPath(folder, filename),
                        getCompletedDownloadReportText(),
                        "utf8",
                    );
                    Toast.success(t("downloading.exportCompletedRecordsSuccess", {
                        filename,
                    }));
                    return true;
                } catch (e: any) {
                    Toast.warn(t("downloading.exportCompletedRecordsFailed", {
                        reason: e?.message ?? e,
                    }));
                    return false;
                }
            },
        });
    }


    return (
        <View style={style.wrapper}>
            {completedWriteStats.completed ? (
                <View style={style.writeSummary}>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary">
                        {t("downloading.writeStatusSummary", {
                            completed: completedWriteStats.completed,
                            metadataFailed:
                                completedWriteStats.metadataFailed,
                            lyricFailed: completedWriteStats.lyricFailed,
                        })}
                    </ThemeText>
                </View>
            ) : null}
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
                <FilterChip
                    title={writeFilterTitle}
                    selected={writeFilter !== "all"}
                    onPress={showWriteFilterSelect}
                    icon="save-outline"
                />
                <FilterChip
                    title={sortTitle}
                    selected={sortMode !== "default"}
                    onPress={showSortSelect}
                    icon="sort-outline"
                />
                {completedFilteredQueue.length ? (
                    <>
                        <FilterChip
                            title={t("downloading.copyCompletedRecords")}
                            selected={false}
                            onPress={copyCompletedDownloadRecords}
                            icon="document-outline"
                        />
                        <FilterChip
                            title={t("downloading.exportCompletedRecords")}
                            selected={false}
                            onPress={exportCompletedDownloadRecords}
                            icon="arrow-up-tray"
                        />
                    </>
                ) : null}
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
    writeSummary: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(16),
    },
    detailContent: {
        gap: rpx(20),
    },
    detailText: {
        lineHeight: rpx(40),
    },
    detailPathActions: {
        flexDirection: "row",
        gap: rpx(16),
        flexWrap: "wrap",
    },
    detailPathAction: {
        minWidth: rpx(208),
        height: rpx(64),
        borderRadius: rpx(8),
        paddingHorizontal: rpx(18),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: rpx(8),
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
