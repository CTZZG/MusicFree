import React, { PropsWithChildren, ReactNode, useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Color from "color";

import Theme from "@/core/theme";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import ThemeText from "./themeText";
import VerticalSafeAreaView from "./verticalSafeAreaView";
import StatusBar from "./statusBar";

export function useShortcutCardStyle(
    options: {
        highlighted?: boolean;
        compact?: boolean;
        elevated?: boolean;
    } = {},
) {
    const colors = useColors();
    const theme = Theme.useTheme();

    return useMemo<StyleProp<ViewStyle>>(() => {
        const isGlass = theme.id === "p-frosted-glass";
        const highlighted = options.highlighted === true;
        const backgroundColor = highlighted
            ? Color(colors.primary).alpha(isGlass ? 0.16 : 0.1).toString()
            : colors.card;

        return {
            alignSelf: "stretch",
            width: "auto",
            marginHorizontal: rpx(16),
            marginVertical: options.compact ? rpx(6) : rpx(8),
            borderRadius: rpx(20),
            borderWidth: 1,
            borderColor: highlighted
                ? Color(colors.primary).alpha(0.5).toString()
                : isGlass
                    ? "rgba(255,255,255,0.58)"
                    : Color(colors.text).alpha(0.07).toString(),
            backgroundColor,
            // Android 会把半透明背景与 elevation 阴影渲染成两层实体色块。
            // 快捷页统一采用单层描边表面，避免“外灰内白/外灰内黑”。
            overflow: "hidden",
        };
    }, [
        colors,
        options.compact,
        options.highlighted,
        theme.id,
    ]);
}

export function ShortcutPageSurface({ children }: PropsWithChildren) {
    return (
        <VerticalSafeAreaView style={styles.page}>
            <View style={styles.page}>{children}</View>
        </VerticalSafeAreaView>
    );
}

export function ShortcutStatusBar() {
    const theme = Theme.useTheme();
    return (
        <StatusBar
            backgroundColor="transparent"
            barStyle={theme.dark ? "light-content" : "dark-content"}
        />
    );
}

export function ShortcutSectionTitle(props: {
    children: ReactNode;
    action?: ReactNode;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <View style={[styles.sectionTitle, props.style]}>
            <ThemeText fontSize="subTitle" fontWeight="bold">
                {props.children}
            </ThemeText>
            {props.action}
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: "transparent",
    },
    sectionTitle: {
        minHeight: rpx(82),
        paddingHorizontal: rpx(30),
        paddingTop: rpx(24),
        paddingBottom: rpx(14),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
});
