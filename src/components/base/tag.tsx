import React from "react";
import { StyleProp, StyleSheet, TextStyle, View, ViewStyle } from "react-native";
import ThemeText from "./themeText";
import useColors from "@/hooks/useColors";
import { maxFontScaleConst } from "@/constants/uiConst";

interface ITagProps {
    tagName: string;
    containerStyle?: StyleProp<ViewStyle>;
    style?: StyleProp<TextStyle>;
}

/** iOS 小标签：灰色填充的圆角块，不描边 */
export default function Tag(props: ITagProps) {
    const colors = useColors();
    return (
        <View
            style={[
                styles.tag,
                { backgroundColor: colors.placeholder },
                props.containerStyle,
            ]}>
            <ThemeText
                style={[styles.tagText, props.style]}
                fontSize="tag"
                fontWeight="semibold"
                fontColor="textSecondary"
                numberOfLines={1}
                maxFontSizeMultiplier={maxFontScaleConst.compact}>
                {props.tagName}
            </ThemeText>
        </View>
    );
}

const styles = StyleSheet.create({
    // 字跟随系统放大时标签跟着变高，不再把字挤出底色
    tag: {
        minHeight: 18,
        marginLeft: 6,
        paddingHorizontal: 6,
        borderRadius: 5,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    tagText: {
        textAlignVertical: "center",
        maxWidth: "100%",
    },
});
