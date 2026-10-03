import React, { ReactNode } from "react";
import { Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";
import ThemeText from "./themeText";
import useColors from "@/hooks/useColors";
import IconButton from "./iconButton";

interface IChipProps {
    containerStyle?: StyleProp<ViewStyle>;
    children?: ReactNode;
    onPress?: () => void;
    onClose?: () => void;
    accessibilityLabel?: string;
    closeAccessibilityLabel?: string;
}
export default function Chip(props: IChipProps) {
    const {
        containerStyle,
        children,
        onPress,
        onClose,
        accessibilityLabel,
        closeAccessibilityLabel,
    } = props;
    const colors = useColors();

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole={onPress ? "button" : undefined}
            accessibilityLabel={
                accessibilityLabel ??
                (typeof children === "string" ? children : undefined)
            }
            style={[
                styles.container,
                {
                    backgroundColor: colors.placeholder,
                },
                containerStyle,
            ]}>
            {typeof children === "string" ? (
                <ThemeText fontSize="subTitle" numberOfLines={1}>
                    {children}
                </ThemeText>
            ) : (
                children
            )}
            <IconButton
                onPress={onClose}
                name="x-mark"
                sizeType="small"
                accessibilityLabel={closeAccessibilityLabel}
                style={styles.icon}
            />
        </Pressable>
    );
}

// iOS 胶囊标签
const styles = StyleSheet.create({
    container: {
        height: 32,
        paddingLeft: 12,
        paddingRight: 8,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    icon: {
        marginLeft: 4,
    },
});
