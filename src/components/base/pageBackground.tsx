import React, { memo } from "react";
import { StatusBar, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import LinearGradient from "react-native-linear-gradient";
import Image from "./image";
import useColors from "@/hooks/useColors";
import Theme from "@/core/theme";
import { useAppConfig } from "@/core/appConfig";

// 液态硅胶主题的默认背景：干净的浅色渐变，只叠少量大而柔和的低饱和光斑，
// 不加高频细节（此前的小色点观感诡异，已移除）。
const GLOW_BLOBS = [
    { id: "glowBlue", color: "#7fb3f7", opacity: 0.22, cx: 0.16, cy: 0.1, r: 0.7 },
    { id: "glowViolet", color: "#b7a8f5", opacity: 0.16, cx: 0.9, cy: 0.4, r: 0.62 },
    { id: "glowTeal", color: "#9fd8c6", opacity: 0.13, cx: 0.2, cy: 0.88, r: 0.6 },
];

function FrostedBackground({ width, height }: { width: number; height: number }) {
    return (
        <>
            <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 0.4, y: 1 }}
                colors={["#eef4fb", "#f3f1fa", "#faf3f6"]}
                style={[style.wrapper, { height }]}
            />
            <Svg
                pointerEvents="none"
                width={width}
                height={height}
                style={style.wrapper}>
                <Defs>
                    {GLOW_BLOBS.map(blob => (
                        <RadialGradient
                            key={blob.id}
                            id={blob.id}
                            cx="50%"
                            cy="50%"
                            r="50%">
                            <Stop
                                offset="0%"
                                stopColor={blob.color}
                                stopOpacity={blob.opacity}
                            />
                            <Stop
                                offset="60%"
                                stopColor={blob.color}
                                stopOpacity={blob.opacity * 0.5}
                            />
                            <Stop
                                offset="100%"
                                stopColor={blob.color}
                                stopOpacity={0}
                            />
                        </RadialGradient>
                    ))}
                </Defs>
                {GLOW_BLOBS.map(blob => (
                    <Circle
                        key={blob.id}
                        cx={width * blob.cx}
                        cy={height * blob.cy}
                        r={width * blob.r}
                        fill={`url(#${blob.id})`}
                    />
                ))}
            </Svg>
        </>
    );
}

function PageBackground() {
    const theme = Theme.useTheme();
    const background = Theme.useBackground();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
                <FrostedBackground width={windowWidth} height={height} />
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
