import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import ThemeText from "./themeText";
import { iconSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { TouchableOpacity } from "react-native-gesture-handler";
import Icon, { IIconName } from "@/components/base/icon.tsx";

interface IProps {
    icon: IIconName;
    onPress?: () => void;
    containerStyle?: StyleProp<ViewStyle>;
    withBorder?: boolean;
    children?: string;
}
export default function (props: IProps) {
    const { icon, children, onPress, containerStyle, withBorder } = props;
    const colors = useColors();

    return (
        <TouchableOpacity
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={children}
            style={[
                styles.container,
                withBorder ? styles.borderContainer : null,
                withBorder ? { borderColor: colors.primary } : null,
                containerStyle,
            ]}
            onPress={onPress}>
            <Icon
                name={icon}
                size={iconSizeConst.light}
                color={colors.primary}
            />
            <ThemeText
                style={styles.text}
                fontSize="subTitle"
                fontColor="primary">
                {children}
            </ThemeText>
        </TouchableOpacity>
    );
}

// iOS 文字按钮：图标和文字都用强调色
const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    text: {
        marginLeft: 5,
    },
    borderContainer: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
});
