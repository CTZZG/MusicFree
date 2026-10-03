import React from "react";
import { StatusBar, StatusBarProps, StyleSheet, View } from "react-native";
import useColors from "@/hooks/useColors";
import Theme from "@/core/theme";

interface IStatusBarProps extends StatusBarProps {}

export default function (props: IStatusBarProps) {
    const colors = useColors();
    const theme = Theme.useTheme();
    const { backgroundColor, barStyle, hidden } = props;

    return (
        <>
            <StatusBar
                {...props}
                backgroundColor={"rgba(0,0,0,0)"}
                barStyle={
                    barStyle ?? (theme.dark ? "light-content" : "dark-content")
                }
            />
            {hidden ? null : (
                <View
                    pointerEvents="none"
                    style={[
                        styles.background,
                        {
                            backgroundColor:
                                backgroundColor ??
                                colors.appBar ??
                                colors.pageBackground,
                            height: StatusBar.currentHeight,
                        },
                    ]}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    background: {
        zIndex: 10000,
        position: "absolute",
        top: 0,
        width: "100%",
    },
});
