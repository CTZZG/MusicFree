import ThemeText from "@/components/base/themeText";
import rpx from "@/utils/rpx";
import React, { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

interface IClassicSectionProps {
    title: string;
    compact?: boolean;
    right?: ReactNode;
    children: ReactNode;
}

export default function ClassicSection(props: IClassicSectionProps) {
    const { title, compact, right, children } = props;

    return (
        <View style={[styles.section, compact ? styles.compactSection : null]}>
            <View style={styles.header}>
                <ThemeText
                    numberOfLines={1}
                    fontSize="title"
                    fontWeight="bold"
                    style={styles.title}>
                    {title}
                </ThemeText>
                {right}
            </View>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginTop: rpx(22),
    },
    compactSection: {
        marginTop: rpx(16),
    },
    header: {
        minHeight: rpx(52),
        paddingHorizontal: rpx(24),
        marginBottom: rpx(14),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: {
        flex: 1,
        minWidth: 0,
        paddingRight: rpx(12),
    },
});
