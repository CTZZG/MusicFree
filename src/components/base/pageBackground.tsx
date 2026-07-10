import React, { memo } from "react";
import { StatusBar, StyleSheet, useWindowDimensions, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Image from "./image";
import useColors from "@/hooks/useColors";
import Theme from "@/core/theme";
import { useAppConfig } from "@/core/appConfig";

// 液态硅胶主题的默认背景：单一柔和渐变，不叠任何光斑。
// 光斑（径向渐变圆）在部分设备上会叠出可见的竖向条带（gradient banding），
// 且背景过浅时半透明白卡片会"隐形"，因此渐变色调要有一定深度。
function FrostedBackground({ height }: { height: number }) {
    return (
        <LinearGradient
            start={{ x: 0, y: 0 }}
            end={{ x: 0.35, y: 1 }}
            colors={["#cfdff2", "#d8d5ee", "#e8d9e6"]}
            style={[style.wrapper, { height }]}
        />
    );
}

function PageBackground() {
    const theme = Theme.useTheme();
    const background = Theme.useBackground();
    const { height: windowHeight } = useWindowDimensions();
    const colors = useColors();
    const frostedCustomBgFrost =
        useAppConfig("theme.frostedCustomBgFrost") ?? true;

    // https://github.com/facebook/react-native/issues/41918
    const height = windowHeight + (StatusBar.currentHeight ?? 0);
    const isFrostedGlass = theme.id === "p-frosted-glass";

    // 液态硅胶主题下自定义背景默认附加磨砂（模糊+降透明度），可用开关关闭
    const backgroundBlur = isFrostedGlass
        ? frostedCustomBgFrost
            ? 28
            : 0
        : background?.blur ?? 20;
    const backgroundOpacity = isFrostedGlass
        ? frostedCustomBgFrost
            ? 0.42
            : background?.opacity ?? 0.6
        : background?.opacity ?? 0.6;

    return (
        <>
            <View
                style={[
                    style.wrapper,
                    {
                        height,
                        backgroundColor:
                            colors?.pageBackground ?? colors.background,
                    },
                ]}
            />
            {isFrostedGlass ? (
                <FrostedBackground height={height} />
            ) : null}
            {(!theme.id.startsWith("p-") || isFrostedGlass) &&
            background?.url ? (
                    <Image
                        uri={background.url}
                        style={[
                            style.wrapper,
                            {
                                height,
                                opacity: backgroundOpacity,
                            },
                        ]}
                        blurRadius={backgroundBlur}
                    />
                ) : null}
        </>
    );
}
export default memo(PageBackground, () => true);

const style = StyleSheet.create({
    wrapper: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
    },
});
