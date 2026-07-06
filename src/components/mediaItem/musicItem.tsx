import React, { useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import rpx from "@/utils/rpx";
import ListItem from "../base/listItem";

import { ImgAsset } from "@/constants/assetsConst";
import LocalMusicSheet from "@/core/localMusicSheet";
import { showPanel } from "../panels/usePanel";
import TitleAndTag from "./titleAndTag";
import ThemeText from "../base/themeText";
import TrackPlayer from "@/core/trackPlayer";
import Icon from "@/components/base/icon.tsx";
import pluginManager from "@/core/pluginManager";
import {
    getAvailableQualities,
    getQualityAbbr,
    TRY_QUALITYS_LIST,
} from "@/utils/qualities";
import DownloadStatusIndicator from "@/components/downloadStatusIndicator";
import { useI18N } from "@/core/i18n";
import Toast from "@/utils/toast";
import { useMediaExtraProperty } from "@/utils/mediaExtra";
import {
    normalizeDownloadWriteResult,
    type DownloadWriteResult,
} from "@/core/downloadFinalizationPolicy";
import useColors from "@/hooks/useColors";

type DownloadWriteStatus = DownloadWriteResult;

interface IMusicItemProps {
    index?: string | number;
    showMoreIcon?: boolean;
    musicItem: IMusic.IMusicItem;
    musicSheet?: IMusic.IMusicSheetItem;
    onItemPress?: (musicItem: IMusic.IMusicItem) => void;
    onItemLongPress?: () => void;
    itemPaddingRight?: number;
    left?: () => JSX.Element;
    containerStyle?: StyleProp<ViewStyle>;
    highlight?: boolean;
    showArtwork?: boolean;
    showQuality?: boolean;
    showDuration?: boolean;
    showAddNextIcon?: boolean;
}

function getMusicItemQualityBadge(musicItem: IMusic.IMusicItem) {
    const plugin = pluginManager.getByMedia(musicItem);
    const availableQualities = getAvailableQualities(musicItem, {
        supportedQualities: plugin?.instance?.supportedQualities,
    });
    const bestQuality = TRY_QUALITYS_LIST.find(quality =>
        availableQualities.includes(quality),
    );

    return bestQuality ? getQualityAbbr(bestQuality) : "";
}

function formatDuration(duration?: number | string) {
    const durationNumber =
        typeof duration === "string" ? Number(duration) : duration;
    if (!durationNumber || !Number.isFinite(durationNumber)) {
        return "";
    }

    const totalSeconds = Math.max(0, Math.round(durationNumber));
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    const paddedSeconds = String(seconds).padStart(2, "0");
    const paddedMinutes = hours ? String(minutes).padStart(2, "0") : minutes;

    return hours
        ? `${hours}:${paddedMinutes}:${paddedSeconds}`
        : `${minutes}:${paddedSeconds}`;
}

function formatMusicMetadata(musicItem: IMusic.IMusicItem) {
    return [musicItem.artist, musicItem.album]
        .map(item =>
            item === undefined || item === null ? "" : String(item).trim(),
        )
        .filter(Boolean)
        .join(" - ");
}

function MusicItem(props: IMusicItemProps) {
    const {
        musicItem,
        index,
        onItemPress,
        onItemLongPress,
        musicSheet,
        itemPaddingRight,
        showMoreIcon = true,
        left: Left,
        containerStyle,
        highlight = false,
        showArtwork = false,
        showQuality = false,
        showDuration = false,
        showAddNextIcon = false,
    } = props;
    const colors = useColors();
    const qualityBadge = useMemo(
        () => showQuality ? getMusicItemQualityBadge(musicItem) : "",
        [musicItem, showQuality],
    );
    const { t } = useI18N();
    const localFileExists = LocalMusicSheet.useLocalFileExists(musicItem);
    const localMusicItem = LocalMusicSheet.useLocalMusic(musicItem);
    const rawDownloadMetadataStatus = useMediaExtraProperty(
        musicItem,
        "downloadMetadataStatus",
    );
    const rawDownloadLyricStatus = useMediaExtraProperty(
        musicItem,
        "downloadLyricStatus",
    );
    const downloadMetadataStatus = normalizeDownloadWriteResult(
        rawDownloadMetadataStatus,
    );
    const downloadLyricStatus = normalizeDownloadWriteResult(
        rawDownloadLyricStatus,
    );
    const downloadWriteBadges = useMemo(() => {
        const badges: Array<{
            key: string;
            text: string;
            status: DownloadWriteStatus;
        }> = [];

        if (downloadMetadataStatus) {
            badges.push({
                key: "metadata",
                text:
                    downloadMetadataStatus === "success"
                        ? t("localMusic.metadataStatus.success")
                        : downloadMetadataStatus === "failed"
                            ? t("localMusic.metadataStatus.failed")
                            : t("localMusic.metadataStatus.skipped"),
                status: downloadMetadataStatus,
            });
        }

        if (downloadLyricStatus && downloadLyricStatus !== "skipped") {
            badges.push({
                key: "lyric",
                text:
                    downloadLyricStatus === "success"
                        ? t("localMusic.lyricFileStatus.success")
                        : t("localMusic.lyricFileStatus.failed"),
                status: downloadLyricStatus,
            });
        }

        return badges;
    }, [downloadMetadataStatus, downloadLyricStatus, t]);
    const durationText = useMemo(
        () => showDuration ? formatDuration(musicItem.duration) : "",
        [musicItem.duration, showDuration],
    );
    const metadataText = useMemo(
        () => formatMusicMetadata(musicItem),
        [musicItem.artist, musicItem.album],
    );

    return (
        <ListItem
            heightType="big"
            style={containerStyle}
            withHorizontalPadding
            leftPadding={index !== undefined ? 0 : undefined}
            rightPadding={itemPaddingRight}
            onLongPress={onItemLongPress}
            onPress={() => {
                if (localMusicItem && localFileExists === false) {
                    Toast.warn(t("localMusic.fileMissingTapHint"));
                    return;
                }
                if (onItemPress) {
                    onItemPress(musicItem);
                } else {
                    TrackPlayer.play(musicItem);
                }
            }}>
            {Left ? <Left /> : null}
            {!Left && showArtwork ? (
                <ListItem.ListItemImage
                    uri={musicItem.artwork}
                    fallbackImg={ImgAsset.albumDefault}
                    contentStyle={styles.artwork}
                />
            ) : null}
            {index !== undefined ? (
                <ListItem.ListItemText
                    width={rpx(86)}
                    position="none"
                    fixedWidth
                    fontColor={highlight ? "primary" : "text"}
                    contentStyle={styles.indexText}>
                    {index}
                </ListItem.ListItemText>
            ) : null}
            <ListItem.Content
                containerStyle={styles.content}
                title={
                    <TitleAndTag
                        title={musicItem.title}
                        titleFontColor={highlight ? "primary": "text"}
                        tag={musicItem.platform}
                    />
                }
                description={
                    <View style={styles.descContainer}>
                        {localMusicItem && (
                            <Icon
                                style={styles.icon}
                                color={localFileExists === false ? "#e66767" : "#11659a"}
                                name={localFileExists === false ? "exclamation-circle" : "check-circle"}
                                size={rpx(22)}
                            />
                        )}
                        {qualityBadge ? (
                            <View style={styles.qualityBadge}>
                                <ThemeText
                                    fontSize="tag"
                                    numberOfLines={1}
                                    style={styles.qualityBadgeText}>
                                    {qualityBadge}
                                </ThemeText>
                            </View>
                        ) : null}
                        {localFileExists !== false
                            ? downloadWriteBadges.map(badge => (
                                <View
                                    key={badge.key}
                                    style={[
                                        styles.writeBadge,
                                        badge.status === "success"
                                            ? styles.writeBadgeSuccess
                                            : badge.status === "failed"
                                                ? styles.writeBadgeFailed
                                                : styles.writeBadgeSkipped,
                                    ]}>
                                    <ThemeText
                                        fontSize="tag"
                                        numberOfLines={1}
                                        style={[
                                            styles.writeBadgeText,
                                            badge.status === "success"
                                                ? styles.writeBadgeTextSuccess
                                                : badge.status === "failed"
                                                    ? styles.writeBadgeTextFailed
                                                    : styles.writeBadgeTextSkipped,
                                        ]}>
                                        {badge.text}
                                    </ThemeText>
                                </View>
                            ))
                            : null}
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            color={
                                localFileExists === false
                                    ? "#e66767"
                                    : undefined
                            }
                            fontColor={highlight ? "primary" : "textSecondary"}
                            style={styles.descText}>
                            {localFileExists === false
                                ? t("localMusic.fileMissing")
                                : metadataText}
                        </ThemeText>
                    </View>
                }
            />
            {durationText ? (
                <ListItem.ListItemText
                    width={rpx(72)}
                    position="none"
                    fixedWidth
                    fontSize="description"
                    fontColor="textSecondary"
                    contentStyle={styles.durationText}>
                    {durationText}
                </ListItem.ListItemText>
            ) : null}
            <DownloadStatusIndicator musicItem={musicItem} />
            {showAddNextIcon ? (
                <ListItem.ListItemIcon
                    width={rpx(48)}
                    hitSlop={{
                        left: rpx(18),
                        right: rpx(18),
                    }}
                    position="none"
                    icon="plus"
                    iconSize={rpx(24)}
                    color={colors.text}
                    containerStyle={[
                        styles.addNextIconContainer,
                        { backgroundColor: colors.placeholder },
                    ]}
                    onPress={() => {
                        if (localMusicItem && localFileExists === false) {
                            Toast.warn(t("localMusic.fileMissingTapHint"));
                            return;
                        }
                        TrackPlayer.addNext(musicItem);
                        Toast.success(t("toast.addToNextPlay"));
                    }}
                />
            ) : null}
            {showMoreIcon ? (
                <ListItem.ListItemIcon
                    width={rpx(48)}
                    hitSlop={{
                        left: rpx(24),
                        right: rpx(24),
                    }}
                    position="none"
                    icon="ellipsis-vertical"
                    onPress={() => {
                        showPanel("MusicItemOptions", {
                            musicItem,
                            musicSheet,
                        });
                    }}
                />
            ) : null}
        </ListItem>
    );
}

export default React.memo(MusicItem);

const styles = StyleSheet.create({
    content: {
        minWidth: 0,
    },
    artwork: {
        width: rpx(68),
        height: rpx(68),
        borderRadius: rpx(12),
    },
    icon: {
        marginRight: rpx(6),
    },
    descContainer: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(16),
        minWidth: 0,
        overflow: "hidden",
    },
    descText: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    qualityBadge: {
        height: rpx(28),
        maxWidth: rpx(72),
        paddingHorizontal: rpx(6),
        marginRight: rpx(8),
        borderRadius: rpx(4),
        borderWidth: 1,
        borderColor: "rgba(61, 169, 252, 0.78)",
        backgroundColor: "rgba(61, 169, 252, 0.18)",
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    qualityBadgeText: {
        color: "#72c7ff",
        includeFontPadding: false,
        lineHeight: rpx(24),
    },
    writeBadge: {
        height: rpx(28),
        maxWidth: rpx(96),
        paddingHorizontal: rpx(6),
        marginRight: rpx(8),
        borderRadius: rpx(4),
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    writeBadgeSuccess: {
        borderColor: "rgba(84, 209, 138, 0.72)",
        backgroundColor: "rgba(84, 209, 138, 0.16)",
    },
    writeBadgeFailed: {
        borderColor: "rgba(230, 103, 103, 0.78)",
        backgroundColor: "rgba(230, 103, 103, 0.16)",
    },
    writeBadgeSkipped: {
        borderColor: "rgba(255,255,255,0.22)",
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    writeBadgeText: {
        includeFontPadding: false,
        lineHeight: rpx(24),
    },
    writeBadgeTextSuccess: {
        color: "#78dba0",
    },
    writeBadgeTextFailed: {
        color: "#ff8585",
    },
    writeBadgeTextSkipped: {
        color: "rgba(255,255,255,0.58)",
    },
    durationText: {
        textAlign: "right",
    },
    addNextIconContainer: {
        width: rpx(34),
        height: rpx(34),
        borderRadius: rpx(17),
        marginRight: rpx(16),
    },

    indexText: {
        fontStyle: "italic",
        textAlign: "center",
        padding: rpx(2),
    },
});
