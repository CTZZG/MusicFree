import React from "react";
import { StyleProp, StyleSheet, View, ViewProps } from "react-native";
import useColors from "@/hooks/useColors";
import { Pressable } from "react-native-gesture-handler";
import Icon from "@/components/base/icon.tsx";

interface ICheckboxProps {
    checked?: boolean;
    onPress?: () => void;
    style?: StyleProp<ViewProps>;
    accessibilityLabel?: string;
}

const slop = 12;

/** iOS 列表编辑态的圆形勾选框 */
export default function Checkbox(props: ICheckboxProps) {
    const { checked, onPress, style, accessibilityLabel } = props;
    const colors = useColors();

    const innerNode = (
        <View
            style={[
                styles.container,
                checked
                    ? {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                    }
                    : {
                        borderColor: colors.textSecondary,
                    },
                style,
            ]}>
            {checked ? <Icon name="check" color="#FFFFFF" size={15} /> : null}
        </View>
    );

    return onPress ? (
        <Pressable
            hitSlop={{
                left: slop,
                right: slop,
                top: slop,
                bottom: slop,
            }}
            onPress={onPress}
            accessibilityRole="checkbox"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: !!checked }}>
            {innerNode}
        </Pressable>
    ) : (
        innerNode
    );
}

const styles = StyleSheet.create({
    container: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
    },
});
