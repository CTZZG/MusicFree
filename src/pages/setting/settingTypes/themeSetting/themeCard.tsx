import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import Image from "@/components/base/image";
import { ImgAsset } from "@/constants/assetsConst";

interface IThemeCardProps {
    selected?: boolean;
    preview?: string;
    previewColors?: string[];
    onPress?: () => void;
    title?: string;
}
export default function ThemeCard(props: IThemeCardProps) {
    const { selected, preview, previewColors, onPress, title } = props;

    const isPreviewColor = preview?.startsWith("#") ? true : false;

    const colors = useColors();

    return (
        <View>
            <Pressable
                onPress={onPress}
                style={[
                    styles.borderContainer,
                    selected
                        ? {
                            borderWidth: 2,
                            borderStyle: "solid",
                            borderColor: colors.primary,
                        }
                        : null,
                ]}>
                <View
                    style={[
                        styles.container,
                        isPreviewColor && !previewColors?.length
                            ? {
                                backgroundColor: preview,
                            }
                            : null,
                    ]}>
                    {previewColors?.length ? (
                        <View style={styles.previewPalette}>
                            {previewColors.map((color, index) => (
                                <View
                                    key={`${color}-${index}`}
                                    style={[
                                        styles.previewColor,
                                        {
                                            backgroundColor: color,
                                            opacity: 1 - index * 0.08,
                                        },
                                    ]}
                                />
                            ))}
                            <View style={styles.glassHighlight} />
                        </View>
                    ) : isPreviewColor ? null : (
                        <Image
                            style={styles.image}
                            uri={preview}
                            emptySrc={ImgAsset.add}
                        />
                    )}
                </View>
            </Pressable>
            <ThemeText
                numberOfLines={1}
                fontSize="subTitle"
                style={styles.title}
                fontColor={selected ? "primary" : "text"}>
                {title}
            </ThemeText>
        </View>
    );
}

const styles = StyleSheet.create({
    borderContainer: {
        width: rpx(160),
        height: rpx(160),
        borderRadius: rpx(22),
        marginRight: rpx(24),
        justifyContent: "center",
        alignItems: "center",
    },
    container: {
        width: rpx(136),
        height: rpx(136),
        borderRadius: rpx(12),
    },
    title: {
        textAlign: "center",
        marginTop: rpx(12),
        width: rpx(160),
    },
    image: {
        width: "100%",
        height: "100%",
        borderRadius: rpx(12),
    },
    previewPalette: {
        width: "100%",
        height: "100%",
        borderRadius: rpx(12),
        overflow: "hidden",
        flexDirection: "row",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255, 255, 255, 0.7)",
    },
    previewColor: {
        flex: 1,
    },
    glassHighlight: {
        position: "absolute",
        top: rpx(10),
        left: rpx(10),
        right: rpx(10),
        height: rpx(32),
        borderRadius: rpx(16),
        backgroundColor: "rgba(255, 255, 255, 0.48)",
    },
});
