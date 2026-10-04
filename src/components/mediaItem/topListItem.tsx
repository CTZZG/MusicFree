import React from "react";
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import FastImage from "@/components/base/fastImage";
import ThemeText from "@/components/base/themeText";
import { ImgAsset } from "@/constants/assetsConst";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";

interface ITopListResultsProps {
    pluginHash: string;
    topListItem: IMusic.IMusicSheetItemBase;
    tintIndex?: number;
    style?: StyleProp<ViewStyle>;
}

// 只使用榜单接口已有的预览，不为列表额外加载每个榜单详情。
export function getTopListPreview(topListItem: IMusic.IMusicSheetItemBase) {
    const musicList: unknown = topListItem.musicList;
    return Array.isArray(musicList)
        ? musicList.filter((music): music is IMusic.IMusicItem =>
            music !== null &&
            typeof music === "object" &&
            typeof music.title === "string" &&
            music.title.trim().length > 0,
        ).slice(0, 3)
        : [];
}

const TILE_COLORS = ["#8071C8", "#479CAB", "#C99143", "#57966B", "#A66591", "#527FB3"];

export default function TopListItem(props: ITopListResultsProps) {
    const { pluginHash, topListItem, tintIndex = 0, style } = props;
    const navigate = useNavigate();
    const colors = useColors();
    const { t } = useI18N();
    const title = topListItem.title?.trim() || t("common.unknownName");
    const cover = topListItem.coverImg || topListItem.artwork;
    const preview = getTopListPreview(topListItem);
    const hasPreview = preview.length > 0;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={() => {
                navigate(ROUTE_PATH.TOP_LIST_DETAIL, {
                    pluginHash: pluginHash,
                    topList: topListItem,
                });
            }}
            style={({ pressed }) => [
                styles.wrapper,
                hasPreview ? styles.previewCard : styles.tile,
                {
                    backgroundColor: hasPreview
                        ? colors.card
                        : TILE_COLORS[tintIndex % TILE_COLORS.length],
                    opacity: pressed ? 0.88 : 1,
                },
                style,
            ]}>
            {hasPreview ? (
                <>
                    <View style={styles.previewTexts}>
                        <ThemeText
                            fontSize="subTitle"
                            fontWeight="bold"
                            numberOfLines={1}
                            style={styles.previewTitle}>
                            {title}
                        </ThemeText>
                        {preview.map((music, index) => (
                            <ThemeText
                                key={index}
                                numberOfLines={1}
                                fontColor="textSecondary"
                                style={styles.previewLine}>
                                {`${index + 1}. ${music.title}${
                                    typeof music.artist === "string" && music.artist
                                        ? ` · ${music.artist}`
                                        : ""
                                }`}
                            </ThemeText>
                        ))}
                    </View>
                    <FastImage
                        style={[styles.previewCover, { backgroundColor: colors.placeholder }]}
                        source={cover}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                </>
            ) : (
                <>
                    <View style={styles.tileAccent} />
                    {cover ? (
                        <FastImage
                            style={StyleSheet.absoluteFill}
                            source={cover}
                            placeholderSource={ImgAsset.albumDefault}
                        />
                    ) : null}
                    <View style={styles.tileTitle}>
                        <ThemeText
                            numberOfLines={2}
                            fontWeight="bold"
                            color="#FFFFFF"
                            style={styles.tileTitleText}>
                            {title}
                        </ThemeText>
                    </View>
                </>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        borderRadius: 14,
        overflow: "hidden",
    },
    tile: {
        aspectRatio: 1,
    },
    tileAccent: {
        position: "absolute",
        width: "140%",
        height: "70%",
        left: "-20%",
        bottom: "-32%",
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.15)",
    },
    tileTitle: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: 8,
        backgroundColor: "rgba(0,0,0,0.58)",
    },
    tileTitleText: {
        fontSize: 12,
        lineHeight: 16,
        textAlign: "center",
    },
    previewCard: {
        minHeight: 104,
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        gap: 12,
    },
    previewTexts: {
        flex: 1,
        minWidth: 0,
    },
    previewTitle: {
        lineHeight: 20,
        marginBottom: 4,
    },
    previewLine: {
        fontSize: 12,
        lineHeight: 18,
    },
    previewCover: {
        width: 72,
        height: 72,
        flexShrink: 0,
        borderRadius: 12,
    },
});
