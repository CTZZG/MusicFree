import React from "react";
import { Pressable } from "react-native";
import ThemeText from "./themeText";
import { CustomizedColors } from "@/hooks/useColors";
import { fontWeightConst } from "@/constants/uiConst";

interface IButtonProps {
    withHorizontalPadding?: boolean;
    style?: any;
    hitSlop?: number;
    children: string;
    fontColor?: keyof CustomizedColors;
    /** 导航栏右侧的“完成”这类主操作用 semibold */
    fontWeight?: keyof typeof fontWeightConst;
    onPress?: () => void;
}

/** iOS 文字按钮：默认用强调色 */
export default function (props: IButtonProps) {
    const {
        children,
        onPress,
        fontColor = "primary",
        fontWeight,
        hitSlop,
        withHorizontalPadding,
    } = props;
    return (
        <Pressable
            {...props}
            style={({ pressed }) => [
                withHorizontalPadding
                    ? {
                        paddingHorizontal: 16,
                    }
                    : null,
                pressed ? { opacity: 0.5 } : null,
                props.style,
            ]}
            hitSlop={hitSlop ?? (withHorizontalPadding ? 0 : 14)}
            onPress={onPress}
            accessible
            accessibilityRole="button"
            accessibilityLabel={children}>
            <ThemeText fontColor={fontColor} fontWeight={fontWeight}>
                {children}
            </ThemeText>
        </Pressable>
    );
}
