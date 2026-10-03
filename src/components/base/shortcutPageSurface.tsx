import React, { PropsWithChildren, ReactNode, useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Color from "color";

import Theme from "@/core/theme";
import useColors from "@/hooks/useColors";
import ThemeText from "./themeText";
import VerticalSafeAreaView from "./verticalSafeAreaView";
import StatusBar from "./statusBar";
import type { CardGroupPosition } from "./cardGroupPosition";

export { getCardGroupPosition } from "./cardGroupPosition";
export type { CardGroupPosition } from "./cardGroupPosition";

export function useShortcutCardStyle(
    options: {
        highlighted?: boolean;
        compact?: boolean;
        elevated?: boolean;
        /** 传了就把连续的行拼成一张 iOS 分组卡片 */
        groupPosition?: CardGroupPosition;
    } = {},
) {
    const colors = useColors();

    return useMemo<StyleProp<ViewStyle>>(() => {
        const highlighted = options.highlighted === true;
        const backgroundColor = highlighted
            ? Color(colors.primary).alpha(0.12).toString()
            : colors.card;

        if (options.groupPosition) {
            const position = options.groupPosition;
            const roundTop = position === "single" || position === "first";
            const roundBottom = position === "single" || position === "last";
            return {
                alignSelf: "stretch",
                width: "auto",
                marginHorizontal: 16,
                borderTopLeftRadius: roundTop ? 14 : 0,
                borderTopRightRadius: roundTop ? 14 : 0,
                borderBottomLeftRadius: roundBottom ? 14 : 0,
                borderBottomRightRadius: roundBottom ? 14 : 0,
                marginBottom: roundBottom ? 12 : 0,
                borderTopWidth: roundTop ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.divider,
                backgroundColor,
                overflow: "hidden",
            };
        }

        // iOS 分组卡片：实色表面靠与页面底色的反差区分，不加阴影；
        // 只有选中态用一圈强调色描边。
        return {
            alignSelf: "stretch",
            width: "auto",
            marginHorizontal: 16,
            marginVertical: options.compact ? 4 : 6,
            borderRadius: 14,
            borderWidth: highlighted ? 1 : 0,
            borderColor: highlighted
                ? Color(colors.primary).alpha(0.5).toString()
                : "transparent",
            backgroundColor,
            overflow: "hidden",
        };
    }, [colors, options.compact, options.groupPosition, options.highlighted]);
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

/** iOS 分组标题：灰色小字，右侧可放一个操作 */
export function ShortcutSectionTitle(props: {
    children: ReactNode;
    action?: ReactNode;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <View style={[styles.sectionTitle, props.style]}>
            <ThemeText fontSize="description" fontColor="textSecondary">
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
        minHeight: 38,
        paddingHorizontal: 32,
        paddingTop: 18,
        paddingBottom: 6,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
});
