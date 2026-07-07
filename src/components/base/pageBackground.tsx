import React, { memo } from "react";
import { StatusBar, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import LinearGradient from "react-native-linear-gradient";
import Image from "./image";
import useColors from "@/hooks/useColors";
import Theme from "@/core/theme";

// 毛玻璃主题背景：底层是有明显方向感的渐变，上面铺色彩浓、边界清晰的
// 光斑和小色点。背景必须有足够的高频细节，玻璃面的实时模糊才肉眼可见——
// 之前失败的原因就是背景过于平滑，模糊前后没有区别。
const GLOW_BLOBS = [
    { id: "glowBlue", color: "#3d8bff", opacity: 0.75, cx: 0.14, cy: 0.12, r: 0.5 },
    { id: "glowViolet", color: "#8f6bff", opacity: 0.62, cx: 0.92, cy: 0.26, r: 0.46 },
    { id: "glowMint", color: "#27c99a", opacity: 0.55, cx: 0.1, cy: 0.62, r: 0.42 },
    { id: "glowAmber", color: "#ffb03a", opacity: 0.5, cx: 0.82, cy: 0.58, r: 0.36 },
    { id: "glowPink", color: "#ff6fa5", opacity: 0.58, cx: 0.5, cy: 0.92, r: 0.46 },
];

// 小而实的色点：被玻璃盖住时会被明显晕开，是"这块是毛玻璃"最直接的视觉证据。
const ACCENT_DOTS = [
    { color: "#2f7fff", opacity: 0.5, cx: 0.32, cy: 0.3, r: 0.05 },
    { color: "#ff86b3", opacity: 0.48, cx: 0.7, cy: 0.14, r: 0.04 },
    { color: "#28d1a5", opacity: 0.45, cx: 0.58, cy: 0.46, r: 0.045 },
    { color: "#9a79ff", opacity: 0.42, cx: 0.24, cy: 0.82, r: 0.05 },
    { color: "#ffb03a", opacity: 0.4, cx: 0.86, cy: 0.8, r: 0.04 },
];

function FrostedBackground({ width, height }: { width: number; height: number }) {
    return (
        <>
            <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                colors={["#dbe9ff", "#ece4ff", "#ffe9f2"]}
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
                                offset="70%"
                                stopColor={blob.color}
                                stopOpacity={blob.opacity * 0.55}
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
                {ACCENT_DOTS.map((dot, index) => (
                    <Circle
                        key={index}
                        cx={width * dot.cx}
                        cy={height * dot.cy}
                        r={width * dot.r}
                        fill={dot.color}
                        fillOpacity={dot.opacity}
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

    // https://github.com/facebook/react-native/issues/41918
    const height = windowHeight + (StatusBar.currentHeight ?? 0);
    const isFrostedGlass = theme.id === "p-frosted-glass";

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
                                opacity: background?.opacity ?? 0.6,
                            },
                        ]}
                        blurRadius={background?.blur ?? 20}
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
