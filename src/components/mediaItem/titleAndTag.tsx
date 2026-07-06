import React from "react";
import { StyleSheet, View } from "react-native";
import ThemeText from "../base/themeText";
import Tag from "../base/tag";
import { CustomizedColors } from "@/hooks/useColors";
import rpx from "@/utils/rpx";

interface ITitleAndTagProps {
    title: string;
    titleFontColor?: keyof CustomizedColors
    tag?: string;
}
export default function TitleAndTag(props: ITitleAndTagProps) {
    const { title, tag, titleFontColor } = props;
    return (
        <View style={styles.container}>
            <ThemeText fontColor={titleFontColor} numberOfLines={1} style={styles.title}>
                {title}
            </ThemeText>
            {tag ? <Tag tagName={tag} containerStyle={styles.tag} /> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        minWidth: 0,
    },
    title: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    tag: {
        maxWidth: rpx(176),
        flexShrink: 1,
    },
});
