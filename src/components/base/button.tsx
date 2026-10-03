import {
    GestureResponderEvent,
    StyleProp,
    StyleSheet,
    TouchableOpacity,
    ViewStyle,
} from "react-native";
import useColors from "@/hooks/useColors.ts";
import ThemeText from "@/components/base/themeText.tsx";
import React from "react";

/**
 * iOS 按钮：primary 是强调色填充的主按钮，normal 是灰色填充、强调色文字的次按钮。
 */
export function Button(props: {
    type?: "normal" | "primary";
    text: string;
    style?: StyleProp<ViewStyle>;
    onPress?: (evt: GestureResponderEvent) => void;
}) {
    const { type = "normal", text, style, onPress } = props;
    const colors = useColors();

    return (
        <TouchableOpacity
            activeOpacity={0.6}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={text}
            style={[
                styles.bottomBtn,
                {
                    backgroundColor:
                        type === "normal" ? colors.placeholder : colors.primary,
                },
                style,
            ]}>
            <ThemeText
                fontWeight="semibold"
                color={type === "normal" ? colors.primary : "white"}>
                {text}
            </ThemeText>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    bottomBtn: {
        borderRadius: 12,
        flexShrink: 0,
        justifyContent: "center",
        alignItems: "center",
        height: 46,
        paddingHorizontal: 16,
    },
});
