import React from "react";
import { StatusBar, StatusBarProps, View } from "react-native";
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
                    style={{
                        zIndex: 10000,
                        position: "absolute",
                        top: 0,
                        backgroundColor:
                            backgroundColor ?? colors.appBar ?? colors.primary,
                        width: "100%",
                        height: StatusBar.currentHeight,
                    }}
                />
            )}
        </>
    );
}
