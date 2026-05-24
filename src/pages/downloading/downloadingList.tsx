import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ListItem from "@/components/base/listItem";
import { sizeFormatter } from "@/utils/fileUtils";
import downloader, {
    DownloadFailReason,
    DownloadStatus,
    useDownloadQueue,
    useDownloadTask,
} from "@/core/downloader";
import { FlashList } from "@shopify/flash-list";
import { useI18N } from "@/core/i18n";


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

        description = t("downloading.downloadStatus.downloadProgress", {
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

export default function DownloadingList() {
    const downloadQueue = useDownloadQueue();


    return (
        <View style={style.wrapper}>
            <FlashList
                style={style.downloading}
                data={downloadQueue}
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
    downloading: {
        flexGrow: 0,
    },
});
