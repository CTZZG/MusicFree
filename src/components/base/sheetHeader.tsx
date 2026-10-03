import React, { ReactNode, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import FastImage from "./fastImage";
import Icon from "./icon";
import ThemeText from "./themeText";
import { ImgAsset } from "@/constants/assetsConst";
import useColors from "@/hooks/useColors";

interface ISheetHeaderProps {
    artwork?: string | null;
    title?: string;
    /** 标题下面的强调色一行：歌手、创建者或来源 */
    subtitle?: string;
    /** 灰色小字：歌曲数量等 */
    meta?: string;
    description?: string;
    /** “我喜欢”没有封面时画粉底白心 */
    favorite?: boolean;
    /** 播放、随机播放等按钮 */
    children?: ReactNode;
}

const DESCRIPTION_LINES = 2;

/**
 * iOS 歌单/专辑页头部：居中的大封面、标题、强调色副标题，下面放播放按钮。
 * 简介默认两行，点一下展开。
 */
export default function SheetHeader(props: ISheetHeaderProps) {
    const { artwork, title, subtitle, meta, description, favorite, children } =
        props;
    const colors = useColors();
    const { width } = useWindowDimensions();
    const [expanded, setExpanded] = useState(false);
    const artworkSize = Math.min(220, Math.round(width * 0.56));

    return (
        <View style={styles.wrapper}>
            <View
                style={[
                    styles.artwork,
                    {
                        width: artworkSize,
                        height: artworkSize,
                        backgroundColor: favorite
                            ? FAVORITE_TILE_COLOR
                            : colors.placeholder,
                    },
                ]}>
                {artwork || !favorite ? (
                    <FastImage
                        style={StyleSheet.absoluteFill}
                        source={artwork ?? undefined}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                ) : (
                    <Icon
                        name="heart"
                        size={Math.round(artworkSize * 0.34)}
                        color="#FFFFFF"
                    />
                )}
            </View>
            {title ? (
                <ThemeText
                    accessibilityRole="header"
                    numberOfLines={2}
                    fontWeight="bold"
                    style={styles.title}>
                    {title}
                </ThemeText>
            ) : null}
            {subtitle ? (
                <ThemeText
                    numberOfLines={1}
                    fontSize="title"
                    fontColor="primary"
                    style={styles.centered}>
                    {subtitle}
                </ThemeText>
            ) : null}
            {meta ? (
                <ThemeText
                    numberOfLines={1}
                    fontSize="description"
                    fontColor="textSecondary"
                    style={[styles.centered, styles.meta]}>
                    {meta}
                </ThemeText>
            ) : null}
            {children}
            {description ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setExpanded(value => !value)}
                    style={styles.description}>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        numberOfLines={expanded ? undefined : DESCRIPTION_LINES}>
                        {description}
                    </ThemeText>
                </Pressable>
            ) : null}
        </View>
    );
}

const FAVORITE_TILE_COLOR = "#F2456B";

const styles = StyleSheet.create({
    wrapper: {
        alignItems: "center",
        paddingTop: 12,
        paddingBottom: 8,
    },
    artwork: {
        borderRadius: 12,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        elevation: 10,
        shadowColor: "#000000",
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
    },
    title: {
        marginTop: 16,
        marginHorizontal: 24,
        fontSize: 22,
        lineHeight: 28,
        textAlign: "center",
    },
    centered: {
        marginHorizontal: 24,
        textAlign: "center",
    },
    meta: {
        marginTop: 2,
    },
    description: {
        alignSelf: "stretch",
        marginHorizontal: 20,
        marginTop: 4,
    },
});
