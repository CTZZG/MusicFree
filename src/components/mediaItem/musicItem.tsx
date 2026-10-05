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
    isSkippedDownloadWriteResult,
    normalizeDownloadWriteResult,
    type DownloadWriteResult,
} from "@/core/downloadFinalizationPolicy";
import useColors from "@/hooks/useColors";
import useLocalMusicArtwork from "@/hooks/useLocalMusicArtwork";
import Tag from "../base/tag";
import { useThemeTextFontScale } from "../base/fontScaleScope";
import { maxFontScaleConst } from "@/constants/uiConst";
import {
    CardGroupPosition,
    useShortcutCardStyle,
} from "../base/shortcutPageSurface";
import {
    getMusicItemAccessibilityLabel,
    withAccessibilitySuffixes,
} from "@/utils/a11yLabels";

type DownloadWriteStatus = DownloadWriteResult;

/** 1 倍字体时时长那一栏的最小宽度，放得下「12:34」，更长的（超过一小时）跟着变宽 */
const DURATION_MIN_WIDTH = 36;

const MORE_ICON_HIT_SLOP = { left: 12, right: 12 };
const ARTWORK_SIZE = rpx(68);
/**
 * 带封面的普通歌曲行（没有序号）里，歌名离行左边多远：行的左边距 + 封面 + 封面和文字的间距。
 * 挂在歌曲行下面、要和歌名对齐的附属行（比如搜索总览里同一首歌的其他来源）用它。
 */
export const MUSIC_ITEM_ARTWORK_TEXT_INSET = ListItem.Padding + ARTWORK_SIZE + ListItem.Padding;

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
    presentation?: "plain" | "cards";
    cardIndex?: string | number;
    /** 卡片样式下这一行在分组里的位置 */
    cardGroupPosition?: CardGroupPosition;
    selected?: boolean;
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

function formatMusicMetadata(
    artist?: string,
    album?: string,
) {
    return [artist, album]
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
        presentation = "plain",
        cardIndex,
        cardGroupPosition,
        selected,
    } = props;
    const colors = useColors();
    const themeTextFontScale = useThemeTextFontScale();
    const qualityBadge = useMemo(
        () => showQuality ? getMusicItemQualityBadge(musicItem) : "",
        [musicItem, showQuality],
    );
    const { t } = useI18N();
    const localFileExists = LocalMusicSheet.useLocalFileExists(musicItem);
    const localMusicItem = LocalMusicSheet.useLocalMusic(musicItem);
    const displayArtwork = useLocalMusicArtwork({
        artwork: musicItem.artwork,
        enabled: showArtwork && localFileExists !== false,
        localMusicItem,
    });
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

        if (
            downloadLyricStatus &&
            !isSkippedDownloadWriteResult(downloadLyricStatus)
        ) {
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
        () => formatMusicMetadata(musicItem.artist, musicItem.album),
        [musicItem.artist, musicItem.album],
    );
    const cardStyle = useShortcutCardStyle({
        highlighted: highlight,
        groupPosition: cardGroupPosition,
    });
    const isCard = presentation === "cards";
    const accessibilityLabel = useMemo(
        () =>
            withAccessibilitySuffixes(
                getMusicItemAccessibilityLabel(
                    musicItem,
                    t("common.unknownName"),
                ),
                [localFileExists === false ? t("localMusic.fileMissing") : null],
            ),
        [musicItem, localFileExists, t],
    );

    return (
        <ListItem
            heightType="none"
            pressableStyle={isCard ? cardStyle : null}
            style={[
                containerStyle,
                isCard ? styles.cardContainer : styles.plainContainer,
            ]}
            withHorizontalPadding
            leftPadding={isCard ? rpx(14) : index !== undefined ? 0 : undefined}
            rightPadding={isCard ? rpx(6) : itemPaddingRight}
            onLongPress={onItemLongPress}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={
                localFileExists === false
                    ? t("localMusic.fileMissingTapHint")
                    : undefined
            }
            accessibilityState={
                selected !== undefined ? { selected } : undefined
            }
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
            {isCard && cardIndex !== undefined ? (
                <ListItem.ListItemText
                    width={rpx(52)}
                    position="none"
                    fixedWidth
                    fontColor={highlight ? "primary" : "text"}
                    contentStyle={styles.indexText}>
                    {cardIndex}
                </ListItem.ListItemText>
            ) : null}
            {!Left && showArtwork ? (
                <ListItem.ListItemImage
                    uri={displayArtwork}
                    fallbackImg={ImgAsset.albumDefault}
                    contentStyle={styles.artwork}
                />
            ) : null}
            {!isCard && index !== undefined ? (
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
                    isCard ? (
                        <ThemeText
                            numberOfLines={1}
                            fontWeight="semibold"
                            fontColor={highlight ? "primary" : "text"}
                            style={styles.cardTitle}>
                            {musicItem.title}
                        </ThemeText>
                    ) : (
                        <TitleAndTag
                            title={musicItem.title}
                            titleFontColor={highlight ? "primary": "text"}
                            tag={musicItem.platform}
                        />
                    )
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
                                    maxFontSizeMultiplier={maxFontScaleConst.compact}
                                    style={styles.qualityBadgeText}>
                                    {qualityBadge}
                                </ThemeText>
                            </View>
                        ) : null}
                        {isCard ? (
                            <ThemeText
                                numberOfLines={1}
                                fontSize="description"
                                color={
                                    localFileExists === false
                                        ? "#e66767"
                                        : undefined
                                }
                                fontColor={highlight ? "primary" : "textSecondary"}
                                style={styles.cardDescText}>
                                {localFileExists === false
                                    ? t("localMusic.fileMissing")
                                    : metadataText}
                            </ThemeText>
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
                                        maxFontSizeMultiplier={maxFontScaleConst.compact}
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
                        {!isCard ? (
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
                        ) : null}
                    </View>
                }
            />
            {isCard ? (
                <View style={styles.cardMeta}>
                    {musicItem.platform ? (
                        <Tag
                            tagName={musicItem.platform}
                            containerStyle={styles.cardSourceTag}
                        />
                    ) : null}
                    {durationText ? (
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            style={styles.cardDuration}>
                            {durationText}
                        </ThemeText>
                    ) : null}
                </View>
            ) : durationText ? (
                <ListItem.ListItemText
                    position="none"
                    fontSize="description"
                    fontColor="textSecondary"
                    containerStyle={[
                        styles.duration,
                        { minWidth: DURATION_MIN_WIDTH * themeTextFontScale },
                    ]}
                    contentStyle={styles.durationText}
                    contentProps={{ numberOfLines: 1 }}>
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
                    accessibilityLabel={t("musicList.item.addNext.a11y", {
                        title: musicItem.title,
                    })}
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
                    // 图标 22 宽，左右各放宽 12：任何屏幕上都有 44 以上的点击宽度
                    // （以前按屏宽算，320 dp 的手机上只有 42）
                    hitSlop={MORE_ICON_HIT_SLOP}
                    position="none"
                    icon="ellipsis-vertical"
                    accessibilityLabel={t("musicList.item.moreOptions.a11y", {
                        title: musicItem.title,
                    })}
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
    plainContainer: {
        // 字体放大、两行文字放不下时跟着变高（以前固定 64）
        minHeight: ListItem.Size.big,
    },
    cardContainer: {
        minHeight: rpx(132),
        paddingVertical: rpx(14),
    },
    cardTitle: {
        fontSize: rpx(30),
        lineHeight: rpx(40),
    },
    artwork: {
        width: ARTWORK_SIZE,
        height: ARTWORK_SIZE,
        borderRadius: rpx(12),
    },
    cardMeta: {
        width: rpx(128),
        minHeight: rpx(84),
        alignItems: "flex-end",
        justifyContent: "center",
        paddingHorizontal: rpx(8),
        flexShrink: 0,
    },
    cardSourceTag: {
        maxWidth: rpx(124),
        marginRight: 0,
    },
    cardDuration: {
        marginTop: rpx(12),
        textAlign: "right",
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
    cardDescText: {
        flexShrink: 1,
        minWidth: rpx(72),
        marginRight: rpx(8),
    },
    qualityBadge: {
        minHeight: rpx(28),
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
        minHeight: rpx(28),
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
    duration: {
        // 时长靠右对齐：短的不足最小宽度时，各行的右边仍然对齐
        justifyContent: "flex-end",
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
