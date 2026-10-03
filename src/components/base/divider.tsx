import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import useColors from "@/hooks/useColors";

interface IDividerProps {
    vertical?: boolean;
    style?: StyleProp<ViewStyle>;
}

/** iOS 分隔线：一个物理像素粗 */
export default function Divider(props: IDividerProps) {
    const { vertical, style } = props;
    const colors = useColors();

    return (
        <View
            style={[
                vertical ? css.dividerVertical : css.divider,
                {
                    backgroundColor: colors.divider ?? "#999999",
                },
                style,
            ]}
        />
    );
}

const css = StyleSheet.create({
    divider: {
        width: "100%",
        height: StyleSheet.hairlineWidth,
    },
    dividerVertical: {
        height: "100%",
        width: StyleSheet.hairlineWidth,
    },
});
