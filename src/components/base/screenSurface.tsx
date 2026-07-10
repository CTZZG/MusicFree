import React, { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import Theme from "@/core/theme";
import PageBackground from "./pageBackground";

export default function ScreenSurface({ children }: PropsWithChildren) {
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
            <PageBackground />
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
