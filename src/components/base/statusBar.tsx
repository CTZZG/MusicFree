import React from "react";
import { StatusBar, StatusBarProps, StyleSheet, View } from "react-native";
import useColors from "@/hooks/useColors";

interface IStatusBarProps extends StatusBarProps {}

export default function (props: IStatusBarProps) {
    const colors = useColors();
    const { backgroundColor, barStyle, hidden } = props;

    return (
        <>
            <StatusBar
                {...props}
                backgroundColor={"rgba(0,0,0,0)"}
                barStyle={barStyle ?? "light-content"}
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
                                colors.primary,
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
