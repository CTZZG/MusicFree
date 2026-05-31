import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import {
    DownloadFailReason,
    DownloadStatus,
    useDownloadTask,
} from "@/core/downloader";
import { useI18N } from "@/core/i18n";
import { sizeFormatter } from "@/utils/fileUtils";
import rpx from "@/utils/rpx";

interface IDownloadStatusIndicatorProps {
    musicItem: IMusic.IMusicItem;
}

export default function DownloadStatusIndicator(
    props: IDownloadStatusIndicatorProps,
) {
    const { musicItem } = props;
    const task = useDownloadTask(musicItem);
    const { t } = useI18N();

    const { text, tone, progress } = useMemo(() => {
        if (!task) {
            return {
                text: "",
                tone: "muted" as const,
                progress: 0,
            };
        }

        if (task.status === DownloadStatus.Error) {
            const reason = task.errorReason;
            const text =
                reason === DownloadFailReason.NoWritePermission
                    ? t("downloading.downloadFailReason.noWritePermission")
                    : reason === DownloadFailReason.FailToFetchSource
                      ? t("downloading.downloadFailReason.failToFetchSource")
                      : reason ===
                          DownloadFailReason.EncryptedMediaUnsupported
                        ? t(
                            "downloading.downloadFailReason.encryptedMediaUnsupported",
                        )
                        : t("downloading.downloadFailReason.unknown");
            return {
                text,
                tone: "error" as const,
                progress: 0,
            };
        }

        if (task.status === DownloadStatus.Completed) {
            return {
                text: t("downloading.downloadStatus.completed"),
                tone: "success" as const,
                progress: 1,
            };
        }

        if (task.status === DownloadStatus.Downloading) {
            const progress =
                task.fileSize && task.downloadedSize
                    ? task.downloadedSize / task.fileSize
                    : 0;
            const text =
                task.progressText ||
                t("downloading.downloadStatus.downloadProgress", {
                    progress: task.downloadedSize
                        ? sizeFormatter(task.downloadedSize)
                        : "-",
                    totalSize: task.fileSize
                        ? sizeFormatter(task.fileSize)
                        : "-",
                });
            return {
                text,
                tone: "active" as const,
                progress,
            };
        }

        if (task.status === DownloadStatus.Paused) {
            return {
                text: t("downloading.downloadStatus.paused"),
                tone: "muted" as const,
                progress: task.fileSize && task.downloadedSize
                    ? task.downloadedSize / task.fileSize
                    : 0,
            };
        }

        return {
            text:
                task.status === DownloadStatus.Preparing
                    ? t("downloading.downloadStatus.preparing")
                    : t("downloading.downloadStatus.pending"),
            tone: "muted" as const,
            progress: 0,
        };
    }, [t, task]);

    if (!task || !text) {
        return null;
    }

    return (
        <View style={styles.container}>
            <ThemeText
                numberOfLines={1}
                fontSize="tag"
                style={[
                    styles.text,
                    tone === "active"
                        ? styles.activeText
                        : tone === "success"
                          ? styles.successText
                          : tone === "error"
                            ? styles.errorText
                            : styles.mutedText,
                ]}>
                {text}
            </ThemeText>
            {task.status === DownloadStatus.Downloading ||
            task.status === DownloadStatus.Paused ? (
                <View style={styles.progressTrack}>
                    <View
                        style={[
                            styles.progressFill,
                            {
                                width: `${Math.max(
                                    4,
                                    Math.min(100, progress * 100),
                                )}%`,
                            },
                        ]}
                    />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        minWidth: rpx(108),
        maxWidth: rpx(180),
        marginRight: rpx(10),
        alignItems: "flex-end",
    },
    text: {
        includeFontPadding: false,
    },
    activeText: {
        color: "#63c7ff",
    },
    successText: {
        color: "#54d18a",
    },
    errorText: {
        color: "#ff6b6b",
    },
    mutedText: {
        color: "rgba(255,255,255,0.55)",
    },
    progressTrack: {
        width: "100%",
        height: rpx(4),
        marginTop: rpx(6),
        borderRadius: rpx(2),
        backgroundColor: "rgba(255,255,255,0.16)",
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: rpx(2),
        backgroundColor: "#63c7ff",
    },
});
