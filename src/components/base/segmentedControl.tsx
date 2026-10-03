import React from "react";
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Theme from "@/core/theme";
import useColors from "@/hooks/useColors";
import ThemeText from "./themeText";

interface ISegmentedControlProps {
    segments: string[];
    /** 读屏用的完整描述，缺省用 segments */
    accessibilityLabels?: string[];
    selectedIndex: number;
    onChange: (index: number) => void;
    style?: StyleProp<ViewStyle>;
}

/** iOS 分段控件：灰色胶囊底，选中的一段是浮起的白块（深色下是灰块） */
export default function SegmentedControl(props: ISegmentedControlProps) {
    const { segments, accessibilityLabels, selectedIndex, onChange, style } =
        props;
    const colors = useColors();
    const dark = Theme.useTheme().dark;

    return (
        <View
            accessibilityRole="tablist"
            style={[styles.track, { backgroundColor: colors.placeholder }, style]}>
            {segments.map((segment, index) => {
                const selected = index === selectedIndex;
                return (
                    <Pressable
                        key={segment}
                        accessibilityRole="tab"
                        accessibilityLabel={
                            accessibilityLabels?.[index] ?? segment
                        }
                        accessibilityState={{ selected }}
                        onPress={() => onChange(index)}
                        style={[
                            styles.segment,
                            selected
                                ? dark
                                    ? styles.selectedDark
                                    : styles.selectedLight
                                : null,
                        ]}>
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontWeight={selected ? "semibold" : "medium"}>
                            {segment}
                        </ThemeText>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    track: {
        flexDirection: "row",
        height: 32,
        padding: 2,
        borderRadius: 9,
    },
    segment: {
        flex: 1,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
    },
    selectedLight: {
        backgroundColor: "#FFFFFF",
        elevation: 2,
        shadowColor: "#000000",
        shadowOpacity: 0.12,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    selectedDark: {
        backgroundColor: "#636366",
    },
});
