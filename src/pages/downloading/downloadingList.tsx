import React, { useMemo, useState } from "react";
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
        } else {
            description = t("downloading.downloadFailReason.unknown");
        }
    } else if (status === DownloadStatus.Completed) {
        description = t("downloading.downloadStatus.completed");
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

function FilterChip(props: {
    title: string;
    selected: boolean;
    onPress: () => void;
}) {
    const { title, selected, onPress } = props;
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

export default function DownloadingList() {
    const downloadQueue = useDownloadQueue();
    const downloadTasks = useDownloadTasksSnapshot();
    const { t } = useI18N();
    const [filter, setFilter] = useState<DownloadFilter>("all");

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

    const filteredQueue = useMemo(
        () =>
            downloadQueue.filter(musicItem => {
                const status =
                    downloadTasks.get(getMediaUniqueKey(musicItem))?.status ??
                    DownloadStatus.Error;
                return matchDownloadFilter(status, filter);
            }),
        [downloadQueue, downloadTasks, filter],
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
    downloading: {
        flexGrow: 0,
    },
});
