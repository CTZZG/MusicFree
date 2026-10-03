import React, { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import Theme from "@/core/theme";
import PageBackground from "./pageBackground";

interface IScreenSurfaceProps extends PropsWithChildren {
    /** 是否在这一页铺用户设置的背景图 */
    showCustomBackground?: boolean;
}

export default function ScreenSurface({
    children,
    showCustomBackground = false,
}: IScreenSurfaceProps) {
    const theme = Theme.useTheme();

    return (
        <View
            style={[
                styles.surface,
                {
                    backgroundColor:
                        theme.colors.pageBackground ?? theme.colors.background,
                },
            ]}>
            <PageBackground showCustomImage={showCustomBackground} />
            <View style={styles.content}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    surface: {
        flex: 1,
        overflow: "hidden",
    },
    content: {
        flex: 1,
    },
});
