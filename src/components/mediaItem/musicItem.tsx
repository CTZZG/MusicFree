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

export default function MusicItem(props: IMusicItemProps) {
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
    } = props;
    const qualityBadge = useMemo(
        () => showQuality ? getMusicItemQualityBadge(musicItem) : "",
        [musicItem, showQuality],
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
                title={
                    <TitleAndTag
                        title={musicItem.title}
                        titleFontColor={highlight ? "primary": "text"}
                        tag={musicItem.platform}
                    />
                }
                description={
                    <View style={styles.descContainer}>
                        {LocalMusicSheet.isLocalMusic(musicItem) && (
                            <Icon
                                style={styles.icon}
                                color="#11659a"
                                name="check-circle"
                                size={rpx(22)}
                            />
                        )}
                        {qualityBadge ? (
                            <View style={styles.qualityBadge}>
                                <ThemeText
                                    fontSize="tag"
                                    style={styles.qualityBadgeText}>
                                    {qualityBadge}
                                </ThemeText>
                            </View>
                        ) : null}
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontColor={highlight ? "primary" : "textSecondary"}
                            style={styles.descText}>
                            {musicItem.artist}
                            {musicItem.album ? ` - ${musicItem.album}` : ""}
                        </ThemeText>
                    </View>
                }
            />
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

const styles = StyleSheet.create({
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
    },
    descText: {
        flexShrink: 1,
    },
    qualityBadge: {
        height: rpx(28),
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

    indexText: {
        fontStyle: "italic",
        textAlign: "center",
        padding: rpx(2),
    },
});
