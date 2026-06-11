import React from "react";
import ListItem from "@/components/base/listItem";
import { ImgAsset } from "@/constants/assetsConst";
import TitleAndTag from "./titleAndTag";
import Tag from "../base/tag";
import ThemeText from "../base/themeText";
import useColors from "@/hooks/useColors";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";

interface IAlbumResultsProps {
    lyricItem: ILyric.ILyricItem;
    onPress?: (musicItem: ILyric.ILyricItem) => void;
    onPreview?: (musicItem: ILyric.ILyricItem) => void;
    matchLabel?: string;
    previewActive?: boolean;
}
export default function LyricItem(props: IAlbumResultsProps) {
    const { lyricItem, onPress, onPreview, matchLabel, previewActive } = props;
    const colors = useColors();

    return (
        <ListItem
            heightType="big"
            withHorizontalPadding
            onPress={() => {
                onPress?.(lyricItem);
            }}>
            <ListItem.ListItemImage
                uri={lyricItem.artwork}
                fallbackImg={ImgAsset.albumDefault}
            />
            <ListItem.Content
                description={
                    <View style={styles.descriptionRow}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            numberOfLines={1}
                            style={styles.artist}>
                            {lyricItem.artist ?? ""}
                        </ThemeText>
                        {matchLabel ? <Tag tagName={matchLabel} /> : null}
                    </View>
                }
                title={
                    <TitleAndTag
                        title={lyricItem.title}
                        tag={lyricItem.platform}
                    />
                }
            />
            {onPreview ? (
                <ListItem.ListItemIcon
                    icon="document-outline"
                    position="right"
                    color={previewActive ? colors.primary : colors.text}
                    onPress={() => onPreview(lyricItem)}
                />
            ) : null}
        </ListItem>
    );
}

const styles = StyleSheet.create({
    descriptionRow: {
        marginTop: rpx(8),
        flexDirection: "row",
        alignItems: "center",
    },
    artist: {
        flexShrink: 1,
    },
});
