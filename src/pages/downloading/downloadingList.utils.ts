import { getDirectory, removeFileScheme } from "@/utils/fileUtils";
import { getLocalPath, getMediaUniqueKey } from "@/utils/mediaUtils";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import { DownloadStatus } from "@/core/downloader";
import { useI18N } from "@/core/i18n";
import {
    isSkippedDownloadWriteResult,
    normalizeDownloadWriteResult,
    type DownloadWriteResult,
} from "@/core/downloadFinalizationPolicy";
import { localFileExistsResolver } from "@/utils/localFileStatusCache";

type TFunction = ReturnType<typeof useI18N>["t"];

export type DownloadFilter = "all" | "active" | "paused" | "completed" | "error";
export type DownloadWriteFilter =
    | "all"
    | "metadata-success"
    | "metadata-failed"
    | "metadata-skipped"
    | "lyric-success"
    | "lyric-failed";
export type DownloadFileStatusFilter = "all" | "exists" | "missing" | "unknown";
export type DownloadSortMode =
    | "default"
    | "completed-newest"
    | "completed-oldest"
    | "title"
    | "artist"
    | "album"
    | "source";
export type DownloadWriteStatus = DownloadWriteResult;
export type CompletedDownloadFileStatus =
    | "exists"
    | "missing"
    | "unknown"
    | "unavailable";
export type DownloadTaskDetailInfo = {
    filename?: string;
    completedAt?: number;
};

export function areCompletedFileStatusMapsEqual(
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

export function getCompletedDownloadLocalPath(musicItem: IMusic.IMusicItem) {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return null;
    }
    return removeFileScheme(localPath) || null;
}

export function getCompletedDownloadFolderPath(filePath: string | null) {
    if (!filePath) {
        return null;
    }
    const directory = getDirectory(filePath);
    return directory && directory !== filePath ? directory : null;
}

export async function resolveCompletedDownloadFileExists(
    filePath: string | null,
) {
    if (!filePath || filePath.startsWith("content://")) {
        return null;
    }
    return localFileExistsResolver.resolve(filePath);
}

export interface ICompletedDownloadFileEntry {
    key: string;
    path: string | null;
}

export function getCompletedDownloadFileSignature(
    entries: readonly ICompletedDownloadFileEntry[],
) {
    return entries
        .map(entry => `${entry.key}\u0000${entry.path ?? ""}`)
        .join("\u0001");
}

export function getCompletedDownloadFileStatusFromExists(
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

export function getCompletedDownloadFileExistsFromStatus(
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

export function getCompletedDownloadDetailText(
    musicItem: IMusic.IMusicItem,
    taskInfo: DownloadTaskDetailInfo | null | undefined,
    downloadMetadataStatus: DownloadWriteStatus | null,
    downloadLyricStatus: DownloadWriteStatus | null,
    t: TFunction,
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

export function isActiveStatus(status: DownloadStatus) {
    return (
        status === DownloadStatus.Pending ||
        status === DownloadStatus.Preparing ||
        status === DownloadStatus.Downloading ||
        status === DownloadStatus.Finalizing
    );
}

export function matchDownloadFilter(
    status: DownloadStatus,
    filter: DownloadFilter,
) {
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

export function getDownloadWriteStatus(
    musicItem: IMusic.IMusicItem,
    key: "downloadMetadataStatus" | "downloadLyricStatus",
) {
    return normalizeDownloadWriteResult(getMediaExtraProperty(musicItem, key));
}

export function matchDownloadWriteFilter(
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
        return isSkippedDownloadWriteResult(
            getDownloadWriteStatus(musicItem, "downloadMetadataStatus"),
        );
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

export function getCompletedDownloadFileStatus(
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

export function matchDownloadFileStatusFilter(
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

    const fileStatus = getCompletedDownloadFileStatus(musicItem, fileStatusMap);
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

export function normalizeFilterValue(value?: string | null) {
    return `${value ?? ""}`.trim();
}

export function buildTextFilters(values: Array<string | null | undefined>) {
    return [
        "all",
        ...Array.from(
            new Set(values.map(normalizeFilterValue).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b)),
    ];
}

export function matchDownloadLibraryFilters(
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

export function sortDownloadItems(
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

export function formatDownloadCompletedAt(timestamp: number) {
    const date = new Date(timestamp);
    return [
        `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(
            date.getDate(),
        )}`,
        `${padTime(date.getHours())}:${padTime(date.getMinutes())}`,
    ].join(" ");
}

export function getDownloadMetadataStatusText(
    status: DownloadWriteStatus | null,
    t: TFunction,
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

export function getDownloadLyricStatusText(
    status: DownloadWriteStatus | null,
    t: TFunction,
) {
    if (!status || isSkippedDownloadWriteResult(status)) {
        return "";
    }
    return status === "success"
        ? t("localMusic.lyricFileStatus.success")
        : t("localMusic.lyricFileStatus.failed");
}

export function getDownloadDetailMetadataStatusText(
    status: DownloadWriteStatus | null,
    t: TFunction,
) {
    if (!status) {
        return t("downloading.detail.unrecordedWriteStatus");
    }
    if (status === "skipped-disabled") {
        return t("downloading.detail.metadataSkippedDisabled");
    }
    if (status === "skipped-unavailable") {
        return t("downloading.detail.metadataSkippedUnavailable");
    }
    if (status === "skipped-no-content" || status === "skipped") {
        return t("localMusic.metadataStatus.skipped");
    }
    return getDownloadMetadataStatusText(status, t);
}

export function getDownloadDetailLyricStatusText(
    status: DownloadWriteStatus | null,
    t: TFunction,
) {
    if (!status) {
        return t("downloading.detail.unrecordedWriteStatus");
    }
    if (status === "skipped-disabled") {
        return t("downloading.detail.lyricSkippedDisabled");
    }
    if (status === "skipped-no-content") {
        return t("downloading.detail.lyricSkippedNoContent");
    }
    if (status === "skipped-unavailable") {
        return t("downloading.detail.lyricSkippedUnavailable");
    }
    if (status === "skipped") {
        return t("downloading.detail.lyricSkipped");
    }
    return getDownloadLyricStatusText(status, t);
}

export function getDownloadDetailFileStatusText(
    filePath: string | null,
    fileExists: boolean | null,
    t: TFunction,
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
