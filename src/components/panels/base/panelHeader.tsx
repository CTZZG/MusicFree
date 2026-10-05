import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import Divider from "@/components/base/divider";
import i18n from "@/core/i18n";
import { Pressable } from "react-native-gesture-handler";

interface IPanelHeaderProps {
    title: string;
    cancelText?: string;
    okText?: string;
    onCancel?: () => void;
    onOk?: () => void;
    hideButtons?: boolean;
    hideDivider?: boolean;
    style?: StyleProp<ViewStyle>;
}
export default function PanelHeader(props: IPanelHeaderProps) {
    const {
        title,
        cancelText,
        okText,
        onOk,
        onCancel,
        hideButtons,
        hideDivider,
        style,
    } = props;

    return (
        <>
            <View style={[styles.header, style]}>
                {hideButtons ? null : (
                    <Pressable style={styles.button} onPress={onCancel}>
                        <ThemeText fontWeight="medium" numberOfLines={1}>
                            {cancelText || i18n.t("common.cancel")}
                        </ThemeText>
                    </Pressable>
                )}
                <ThemeText
                    style={styles.title}
                    fontWeight="bold"
                    fontSize="title"
                    numberOfLines={1}>
                    {title}
                </ThemeText>
                {hideButtons ? null : (
                    <Pressable
                        style={[styles.button, styles.rightButton]}
                        onPress={onOk}>
                        <ThemeText
                            fontWeight="medium"
                            fontColor="primary"
                            numberOfLines={1}>
                            {okText || i18n.t("common.confirm")}
                        </ThemeText>
                    </Pressable>
                )}
            </View>
            {hideDivider ? null : <Divider />}
        </>
    );
}

const styles = StyleSheet.create({
    header: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(24),
        height: rpx(100),
    },
    // 按钮至少这么宽，文字更长时（英文的 Confirm、Loading...）跟着变宽，
    // 由中间的标题让出位置，不再折成两行
    button: {
        minWidth: rpx(120),
        height: "100%",
        justifyContent: "center",
    },
    rightButton: {
        alignItems: "flex-end",
    },
    title: {
        flex: 1,
        textAlign: "center",
    },
});
