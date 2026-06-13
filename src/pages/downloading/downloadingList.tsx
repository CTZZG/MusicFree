import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { exists } from "react-native-fs";
import rpx from "@/utils/rpx";
import CheckBox from "@/components/base/checkbox";
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
import TrackPlayer from "@/core/trackPlayer";
import { showDialog } from "@/components/dialogs/useDialog";
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
type DownloadFileStatusFilter = "all" | "exists" | "missing" | "unknown";
type DownloadSortMode =
    | "default"
    | "completed-newest"
    | "completed-oldest"
    | "title"
    | "artist"
    | "album"
    | "source";
type DownloadWriteStatus = "success" | "failed" | "skipped";
type CompletedDownloadFileStatus =
    | "exists"
    | "missing"
    | "unknown"
    | "unavailable";
type DownloadTaskDetailInfo = {
    filename?: string;
    completedAt?: number;
};

function areCompletedFileStatusMapsEqual(
    a: Record<string, CompletedDownloadFileStatus>,
    b: Record<string, CompletedDownloadFileStatus>,
) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    return aKeys.every(key => a[key] === b[key]);
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

async function resolveCompletedDownloadFileExists(filePath: string | null) {
    if (!filePath || filePath.startsWith("content://")) {
        return null;
    }
    try {
        return await exists(filePath);
    } catch {
        return false;
    }
}

function getCompletedDownloadFileStatusFromExists(
    filePath: string | null,
    fileExists: boolean | null,
): CompletedDownloadFileStatus {
    if (!filePath) {
        return "unavailable";
    }
    if (fileExists === true) {
        return "exists";
    }
    if (fileExists === false) {
        return "missing";
    }
    return "unknown";
}

function getCompletedDownloadFileExistsFromStatus(
    status: CompletedDownloadFileStatus | undefined,
) {
    if (status === "exists") {
        return true;
    }
    if (status === "missing") {
        return false;
    }
    return null;
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

interface DownloadingListItemProps {
    musicItem: IMusic.IMusicItem;
    fileStatus?: CompletedDownloadFileStatus;
    selectionMode?: boolean;
    selected?: boolean;
    onSelectPress?: () => void;
    onLongPress?: () => void;
    onFileStatusChange?: (
        musicItem: IMusic.IMusicItem,
        status: CompletedDownloadFileStatus,
    ) => void;
}
function DownloadingListItem(props: DownloadingListItemProps) {
    const {
        musicItem,
        fileStatus,
        selectionMode,
        selected,
        onSelectPress,
        onLongPress,
        onFileStatusChange,
    } = props;
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
    const completedLocalPath =
        status === DownloadStatus.Completed
            ? getCompletedDownloadLocalPath(musicItem)
            : null;
    const localFileExists = getCompletedDownloadFileExistsFromStatus(fileStatus);

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
            localFileExists === false
                ? t("downloading.downloadStatus.fileMissing")
                : "",
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

    async function showCompletedDownloadDetail() {
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
        const filePath = completedLocalPath;
        const folderPath = getCompletedDownloadFolderPath(filePath);
        const checkedFileExists =
            await resolveCompletedDownloadFileExists(filePath);
        onFileStatusChange?.(
            musicItem,
            getCompletedDownloadFileStatusFromExists(
                filePath,
                checkedFileExists,
            ),
        );

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
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        color={
                            checkedFileExists === false
                                ? colors.notification
                                : undefined
                        }>
                        {`${t("downloading.detail.fileStatus")}: ${getDownloadDetailFileStatusText(
                            filePath,
                            checkedFileExists,
                            t,
                        )}`}
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
        onLongPress={onLongPress}
        onPress={
            selectionMode
                ? onSelectPress
                : status === DownloadStatus.Completed
                ? showCompletedDownloadDetail
                : undefined
        }>
        {selectionMode ? (
            <View style={style.checkBoxWrapper}>
                <CheckBox checked={selected} />
            </View>
        ) : null}
        <ListItem.Content
            title={musicItem.title}
            description={description}
        />
        {!selectionMode && canRetry ? (
            <ListItem.ListItemIcon
                icon="arrow-path"
                position="right"
                onPress={() => downloader.retry(musicItem)}
            />
        ) : null}
        {!selectionMode && canPause ? (
            <ListItem.ListItemIcon
                icon="pause"
                position="right"
                onPress={() => {
                    void downloader.pause(musicItem);
                }}
            />
        ) : null}
        {!selectionMode && canResume ? (
            <ListItem.ListItemIcon
                icon="play"
                position="right"
                onPress={() => {
                    void downloader.resume(musicItem);
                }}
            />
        ) : null}
        {!selectionMode && canRemove ? (
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

function getCompletedDownloadFileStatus(
    musicItem: IMusic.IMusicItem,
    fileStatusMap: Record<string, CompletedDownloadFileStatus>,
) {
    const key = getMediaUniqueKey(musicItem);
    const knownStatus = fileStatusMap[key];
    if (knownStatus) {
        return knownStatus;
    }
    return getCompletedDownloadFileStatusFromExists(
        getCompletedDownloadLocalPath(musicItem),
        null,
    );
}

function matchDownloadFileStatusFilter(
    musicItem: IMusic.IMusicItem,
    status: DownloadStatus,
    filter: DownloadFileStatusFilter,
    fileStatusMap: Record<string, CompletedDownloadFileStatus>,
) {
    if (filter === "all") {
        return true;
    }
    if (status !== DownloadStatus.Completed) {
        return false;
    }

    const fileStatus = getCompletedDownloadFileStatus(
        musicItem,
        fileStatusMap,
    );
    if (filter === "exists") {
        return fileStatus === "exists";
    }
    if (filter === "missing") {
        return fileStatus === "missing";
    }
    if (filter === "unknown") {
        return fileStatus === "unknown" || fileStatus === "unavailable";
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

function normalizeFilterValue(value?: string | null) {
    return `${value ?? ""}`.trim();
}

function buildTextFilters(values: Array<string | null | undefined>) {
    return [
        "all",
        ...Array.from(
            new Set(values.map(normalizeFilterValue).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b)),
    ];
}

function matchDownloadLibraryFilters(
    musicItem: IMusic.IMusicItem,
    sourceFilter: string,
    artistFilter: string,
    albumFilter: string,
) {
    if (sourceFilter !== "all" && musicItem.platform !== sourceFilter) {
        return false;
    }
    if (
        artistFilter !== "all" &&
        normalizeFilterValue(musicItem.artist) !== artistFilter
    ) {
        return false;
    }
    if (
        albumFilter !== "all" &&
        normalizeFilterValue(musicItem.album) !== albumFilter
    ) {
        return false;
    }
    return true;
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
        if (sortMode === "album") {
            return (
                compareText(a.album, b.album) ||
                compareText(a.artist, b.artist) ||
                compareText(a.title, b.title)
            );
        }
        if (sortMode === "source") {
            return (
                compareText(a.platform, b.platform) ||
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

function getDownloadDetailFileStatusText(
    filePath: string | null,
    fileExists: boolean | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (!filePath) {
        return t("downloading.detail.filePathUnavailable");
    }
    if (fileExists === true) {
        return t("downloading.detail.fileStatusExists");
    }
    if (fileExists === false) {
        return t("downloading.detail.fileStatusMissing");
    }
    return t("downloading.detail.fileStatusUnknown");
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
    const colors = useColors();
    const [filter, setFilter] = useState<DownloadFilter>("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [artistFilter, setArtistFilter] = useState("all");
    const [albumFilter, setAlbumFilter] = useState("all");
    const [writeFilter, setWriteFilter] = useState<DownloadWriteFilter>("all");
    const [fileStatusFilter, setFileStatusFilter] =
        useState<DownloadFileStatusFilter>("all");
    const [sortMode, setSortMode] = useState<DownloadSortMode>("default");
    const [completedFileStatusMap, setCompletedFileStatusMap] = useState<
        Record<string, CompletedDownloadFileStatus>
    >({});
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
        () => new Set(),
    );
    const [selectionAnchorIndex, setSelectionAnchorIndex] =
        useState<number | null>(null);
    const mediaExtraVersion = useMediaExtraVersion();
    const canUseNativeControls = downloader.isNativeDownloadControlAvailable();
    const selectionMode = selectedKeys.size > 0;

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
        () => buildTextFilters(downloadQueue.map(musicItem => musicItem.platform)),
        [downloadQueue],
    );
    const sourceFilterTitle =
        sourceFilter === "all"
            ? t("downloading.sourceFilter.all")
            : sourceFilter;
    const artistFilters = useMemo(
        () => buildTextFilters(downloadQueue.map(musicItem => musicItem.artist)),
        [downloadQueue],
    );
    const artistFilterTitle =
        artistFilter === "all"
            ? t("downloading.artistFilter.all")
            : artistFilter;
    const albumFilters = useMemo(
        () => buildTextFilters(downloadQueue.map(musicItem => musicItem.album)),
        [downloadQueue],
    );
    const albumFilterTitle =
        albumFilter === "all"
            ? t("downloading.albumFilter.all")
            : albumFilter;
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
    const fileStatusFilterItems: Array<{
        key: DownloadFileStatusFilter;
        title: string;
    }> = [
        {
            key: "all",
            title: t("downloading.fileStatusFilter.all"),
        },
        {
            key: "exists",
            title: t("downloading.fileStatusFilter.exists"),
        },
        {
            key: "missing",
            title: t("downloading.fileStatusFilter.missing"),
        },
        {
            key: "unknown",
            title: t("downloading.fileStatusFilter.unknown"),
        },
    ];
    const fileStatusFilterTitle =
        fileStatusFilter === "all"
            ? t("downloading.fileStatusFilter.title")
            : fileStatusFilterItems.find(item => item.key === fileStatusFilter)
                ?.title ?? t("downloading.fileStatusFilter.title");
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
        {
            key: "album",
            title: t("downloading.sort.albumName"),
        },
        {
            key: "source",
            title: t("downloading.sort.sourceName"),
        },
    ];
    const sortTitle =
        sortMode === "default"
            ? t("downloading.sort.title")
            : sortItems.find(item => item.key === sortMode)?.title ??
                t("downloading.sort.title");
    const hasActiveListControls =
        filter !== "all" ||
        sourceFilter !== "all" ||
        artistFilter !== "all" ||
        albumFilter !== "all" ||
        writeFilter !== "all" ||
        fileStatusFilter !== "all" ||
        sortMode !== "default";
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
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
                ) {
                    return false;
                }
                if (!matchDownloadWriteFilter(musicItem, status, writeFilter)) {
                    return false;
                }
                if (
                    !matchDownloadFileStatusFilter(
                        musicItem,
                        status,
                        fileStatusFilter,
                        completedFileStatusMap,
                    )
                ) {
                    return false;
                }
                return true;
            }),
        [
            downloadQueue,
            downloadTasks,
            sourceFilter,
            artistFilter,
            albumFilter,
            writeFilter,
            fileStatusFilter,
            completedFileStatusMap,
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
                fileExists: 0,
                fileMissing: 0,
                fileUnknown: 0,
            };
            downloadQueue.forEach(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                if (status !== DownloadStatus.Completed) {
                    return;
                }
                if (
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
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
                const fileStatus = getCompletedDownloadFileStatus(
                    musicItem,
                    completedFileStatusMap,
                );
                if (fileStatus === "exists") {
                    stats.fileExists += 1;
                } else if (fileStatus === "missing") {
                    stats.fileMissing += 1;
                } else {
                    stats.fileUnknown += 1;
                }
            });
            return stats;
        },
        [
            downloadQueue,
            downloadTasks,
            sourceFilter,
            artistFilter,
            albumFilter,
            completedFileStatusMap,
            mediaExtraVersion,
        ],
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
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter, artistFilter, albumFilter],
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
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter, artistFilter, albumFilter],
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
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
                ) {
                    return false;
                }
                return true;
            }),
        [downloadQueue, downloadTasks, sourceFilter, artistFilter, albumFilter],
    );

    useEffect(() => {
        let cancelled = false;
        const completedItems = downloadQueue.filter(musicItem => {
            const status =
                downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                DownloadStatus.Error;
            return status === DownloadStatus.Completed;
        });
        const initialStatusMap: Record<string, CompletedDownloadFileStatus> =
            {};

        completedItems.forEach(musicItem => {
            const key = getMediaUniqueKey(musicItem);
            initialStatusMap[key] = getCompletedDownloadFileStatusFromExists(
                getCompletedDownloadLocalPath(musicItem),
                null,
            );
        });

        setCompletedFileStatusMap(prev => {
            const next = { ...initialStatusMap };
            Object.keys(next).forEach(key => {
                const prevStatus = prev[key];
                if (
                    prevStatus &&
                    next[key] !== "unavailable" &&
                    next[key] !== "exists" &&
                    next[key] !== "missing"
                ) {
                    next[key] = prevStatus;
                }
            });
            if (areCompletedFileStatusMapsEqual(prev, next)) {
                return prev;
            }
            return next;
        });

        Promise.all(
            completedItems.map(async musicItem => {
                const filePath = getCompletedDownloadLocalPath(musicItem);
                const fileExists =
                    await resolveCompletedDownloadFileExists(filePath);
                return [
                    getMediaUniqueKey(musicItem),
                    getCompletedDownloadFileStatusFromExists(
                        filePath,
                        fileExists,
                    ),
                ] as const;
            }),
        ).then(entries => {
            if (!cancelled) {
                const next = Object.fromEntries(entries);
                setCompletedFileStatusMap(prev =>
                    areCompletedFileStatusMapsEqual(prev, next) ? prev : next,
                );
            }
        });

        return () => {
            cancelled = true;
        };
    }, [downloadQueue, downloadTasks, mediaExtraVersion]);

    useEffect(() => {
        if (!sourceFilters.includes(sourceFilter)) {
            setSourceFilter("all");
        }
    }, [sourceFilter, sourceFilters]);

    useEffect(() => {
        if (!artistFilters.includes(artistFilter)) {
            setArtistFilter("all");
        }
    }, [artistFilter, artistFilters]);

    useEffect(() => {
        if (!albumFilters.includes(albumFilter)) {
            setAlbumFilter("all");
        }
    }, [albumFilter, albumFilters]);

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

    function showArtistFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.artistFilter.title"),
            candidates: artistFilters.map(artist => ({
                title:
                    artist === "all"
                        ? t("downloading.artistFilter.all")
                        : artist,
                value: artist,
                icon: "user",
            })),
            onPress(item) {
                setArtistFilter(item.value);
            },
        });
    }

    function showAlbumFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.albumFilter.title"),
            candidates: albumFilters.map(album => ({
                title:
                    album === "all"
                        ? t("downloading.albumFilter.all")
                        : album,
                value: album,
                icon: "album-outline",
            })),
            onPress(item) {
                setAlbumFilter(item.value);
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

    function showFileStatusFilterSelect() {
        showPanel("SimpleSelect", {
            header: t("downloading.fileStatusFilter.title"),
            candidates: fileStatusFilterItems.map(item => ({
                title: item.title,
                value: item.key,
                icon: "folder-outline",
            })),
            onPress(item) {
                setFileStatusFilter(item.value as DownloadFileStatusFilter);
            },
        });
    }

    function updateCompletedFileStatus(
        musicItem: IMusic.IMusicItem,
        fileStatus: CompletedDownloadFileStatus,
    ) {
        const key = getMediaUniqueKey(musicItem);
        setCompletedFileStatusMap(prev =>
            prev[key] === fileStatus
                ? prev
                : {
                    ...prev,
                    [key]: fileStatus,
                },
        );
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

    function clearListControls() {
        setFilter("all");
        setSourceFilter("all");
        setArtistFilter("all");
        setAlbumFilter("all");
        setWriteFilter("all");
        setFileStatusFilter("all");
        setSortMode("default");
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
                    !matchDownloadLibraryFilters(
                        musicItem,
                        sourceFilter,
                        artistFilter,
                        albumFilter,
                    )
                ) {
                    return false;
                }
                if (!matchDownloadWriteFilter(musicItem, status, writeFilter)) {
                    return false;
                }
                if (
                    !matchDownloadFileStatusFilter(
                        musicItem,
                        status,
                        fileStatusFilter,
                        completedFileStatusMap,
                    )
                ) {
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
            artistFilter,
            albumFilter,
            writeFilter,
            fileStatusFilter,
            completedFileStatusMap,
            sortMode,
            mediaExtraVersion,
        ],
    );

    useEffect(() => {
        if (!filteredQueue.length) {
            setSelectedKeys(prev => (prev.size ? new Set() : prev));
            setSelectionAnchorIndex(prev => (prev === null ? prev : null));
            return;
        }
        setSelectedKeys(prev => {
            const validKeys = new Set(filteredQueue.map(item => getMediaUniqueKey(item)));
            const next = new Set<string>();
            let changed = false;
            prev.forEach(key => {
                if (validKeys.has(key)) {
                    next.add(key);
                } else {
                    changed = true;
                }
            });
            if (!changed && next.size === prev.size) {
                return prev;
            }
            if (!next.size) {
                setSelectionAnchorIndex(prevAnchor =>
                    prevAnchor === null ? prevAnchor : null,
                );
            }
            return next;
        });
    }, [filteredQueue]);

    const selectedItems = useMemo(
        () =>
            filteredQueue.filter(item =>
                selectedKeys.has(getMediaUniqueKey(item)),
            ),
        [filteredQueue, selectedKeys],
    );
    const selectedCount = selectedItems.length;

    function clearSelection() {
        setSelectedKeys(new Set());
        setSelectionAnchorIndex(null);
    }

    function selectAllVisible() {
        setSelectedKeys(new Set(filteredQueue.map(item => getMediaUniqueKey(item))));
        setSelectionAnchorIndex(filteredQueue.length ? 0 : null);
    }

    function toggleSelectionAt(index: number, musicItem: IMusic.IMusicItem) {
        const key = getMediaUniqueKey(musicItem);
        setSelectedKeys(prev => {
            if (
                selectionAnchorIndex !== null &&
                prev.size === 1 &&
                !prev.has(key)
            ) {
                const start = Math.min(selectionAnchorIndex, index);
                const end = Math.max(selectionAnchorIndex, index);
                const next = new Set(prev);
                filteredQueue.slice(start, end + 1).forEach(item => {
                    next.add(getMediaUniqueKey(item));
                });
                return next;
            }

            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
                if (!next.size) {
                    setSelectionAnchorIndex(null);
                }
            } else {
                next.add(key);
                if (selectionAnchorIndex === null) {
                    setSelectionAnchorIndex(index);
                }
            }
            return next;
        });
    }

    function enterSelectionMode(index: number, musicItem: IMusic.IMusicItem) {
        setSelectedKeys(new Set([getMediaUniqueKey(musicItem)]));
        setSelectionAnchorIndex(index);
    }

    function removeSelectedDownloadRecords() {
        showDialog("SimpleDialog", {
            title: t("common.delete"),
            content: t("downloading.selectionRemoveConfirm", {
                count: selectedCount,
            }),
            onOk() {
                const completedItems: IMusic.IMusicItem[] = [];
                const failedItems: IMusic.IMusicItem[] = [];
                const activeItems: IMusic.IMusicItem[] = [];
                selectedItems.forEach(item => {
                    const status =
                        downloadTasks.get(getMediaUniqueKey(item))?.status ??
                        DownloadStatus.Error;
                    if (status === DownloadStatus.Completed) {
                        completedItems.push(item);
                    } else if (status === DownloadStatus.Error) {
                        failedItems.push(item);
                    } else {
                        activeItems.push(item);
                    }
                });

                let count = 0;
                count += downloader.clearCompletedTasks(completedItems);
                count += downloader.clearFailedTasks(failedItems);
                activeItems.forEach(item => {
                    if (downloader.remove(item)) {
                        count += 1;
                    }
                });
                if (count) {
                    Toast.success(t("toast.deleteSuccess"));
                } else {
                    showNoBatchTasksToast();
                }
                clearSelection();
            },
        });
    }

    return (
        <View style={style.wrapper}>
            {downloadQueue.length ? (
                <View style={style.writeSummary}>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary">
                        {t("downloading.librarySummary", {
                            shown: filteredQueue.length,
                            total: downloadQueue.length,
                        })}
                    </ThemeText>
                    {completedWriteStats.completed ? (
                        <>
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
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary">
                                {t("downloading.fileStatusSummary", {
                                    exists: completedWriteStats.fileExists,
                                    missing: completedWriteStats.fileMissing,
                                    unknown: completedWriteStats.fileUnknown,
                                })}
                            </ThemeText>
                        </>
                    ) : null}
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
                    title={artistFilterTitle}
                    selected={artistFilter !== "all"}
                    onPress={showArtistFilterSelect}
                    icon="user"
                />
                <FilterChip
                    title={albumFilterTitle}
                    selected={albumFilter !== "all"}
                    onPress={showAlbumFilterSelect}
                    icon="album-outline"
                />
                <FilterChip
                    title={writeFilterTitle}
                    selected={writeFilter !== "all"}
                    onPress={showWriteFilterSelect}
                    icon="save-outline"
                />
                <FilterChip
                    title={fileStatusFilterTitle}
                    selected={fileStatusFilter !== "all"}
                    onPress={showFileStatusFilterSelect}
                    icon="folder-outline"
                />
                <FilterChip
                    title={sortTitle}
                    selected={sortMode !== "default"}
                    onPress={showSortSelect}
                    icon="sort-outline"
                />
                {hasActiveListControls ? (
                    <FilterChip
                        title={t("downloading.clearFilters")}
                        selected={false}
                        onPress={clearListControls}
                        icon="x-mark"
                    />
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
                ListHeaderComponent={
                    selectionMode ? (
                        <View style={style.selectionHeader}>
                            <ThemeText fontWeight="bold">
                                {t("musicList.selection.selectedCount", {
                                    count: selectedCount,
                                })}
                            </ThemeText>
                            <View style={style.selectionHeaderActions}>
                                <Pressable
                                    style={style.selectionTextButton}
                                    onPress={
                                        selectedCount === filteredQueue.length
                                            ? clearSelection
                                            : selectAllVisible
                                    }>
                                    <ThemeText fontColor="primary">
                                        {selectedCount === filteredQueue.length
                                            ? t("common.unselectAll")
                                            : t("common.selectAll")}
                                    </ThemeText>
                                </Pressable>
                                <Pressable
                                    style={style.selectionTextButton}
                                    onPress={clearSelection}>
                                    <ThemeText fontColor="primary">
                                        {t("common.cancel")}
                                    </ThemeText>
                                </Pressable>
                            </View>
                        </View>
                    ) : null
                }
                ListFooterComponent={
                    selectionMode ? <View style={style.selectionSpacer} /> : null
                }
                extraData={{
                    completedFileStatusMap,
                    selectedKeys,
                    selectionMode,
                }}
                data={filteredQueue}
                keyExtractor={_ => `dl${_.platform}.${_.id}`}
                renderItem={({ item, index }) => {
                    return (
                        <DownloadingListItem
                            musicItem={item}
                            selectionMode={selectionMode}
                            selected={selectedKeys.has(getMediaUniqueKey(item))}
                            onSelectPress={() => {
                                toggleSelectionAt(index, item);
                            }}
                            onLongPress={() => {
                                enterSelectionMode(index, item);
                            }}
                            fileStatus={
                                completedFileStatusMap[
                                    getMediaUniqueKey(item)
                                ]
                            }
                            onFileStatusChange={updateCompletedFileStatus}
                        />
                    );
                }}
            />
            {selectionMode ? (
                <View
                    style={[
                        style.selectionBottomBar,
                        { backgroundColor: colors.appBar },
                    ]}>
                    <SelectionAction
                        icon="motion-play"
                        title={t("musicListEditor.addToNextPlay")}
                        disabled={!selectedCount}
                        onPress={() => {
                            TrackPlayer.addNext(selectedItems);
                            Toast.success(t("toast.addToNextPlay"));
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="clock-outline"
                        title={t("playLater.add")}
                        disabled={!selectedCount}
                        onPress={() => {
                            TrackPlayer.addPlayLater(selectedItems);
                            Toast.success(t("playLater.added"));
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="folder-plus"
                        title={t("musicListEditor.addToSheet")}
                        disabled={!selectedCount}
                        onPress={() => {
                            showPanel("AddToMusicSheet", {
                                musicItem: selectedItems,
                            });
                            clearSelection();
                        }}
                    />
                    <SelectionAction
                        icon="trash-outline"
                        title={t("common.delete")}
                        disabled={!selectedCount}
                        onPress={removeSelectedDownloadRecords}
                    />
                </View>
            ) : null}
        </View>
    );
}

function SelectionAction(props: {
    icon: IIconName;
    title: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { icon, title, disabled, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            style={style.selectionAction}>
            <Icon
                name={icon}
                size={rpx(42)}
                color={colors.appBarText}
                style={disabled ? style.disabledAction : undefined}
            />
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                color={colors.appBarText}
                style={disabled ? style.disabledAction : undefined}>
                {title}
            </ThemeText>
        </Pressable>
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
        gap: rpx(8),
    },
    checkBoxWrapper: {
        marginRight: rpx(18),
        alignItems: "center",
        justifyContent: "center",
    },
    selectionHeader: {
        minHeight: rpx(76),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    selectionHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    selectionTextButton: {
        paddingHorizontal: rpx(12),
        height: rpx(56),
        justifyContent: "center",
    },
    selectionSpacer: {
        height: rpx(132),
    },
    selectionBottomBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: rpx(120),
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
    },
    selectionAction: {
        width: rpx(150),
        height: rpx(104),
        alignItems: "center",
        justifyContent: "center",
        gap: rpx(8),
    },
    disabledAction: {
        opacity: 0.45,
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
