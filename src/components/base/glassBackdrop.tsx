import React from "react";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import rpx from "@/utils/rpx";
import Theme from "@/core/theme";

interface IGlassBackdropProps {
    radius?: number;
    /** 模糊强度 0-100 */
    intensity?: number;
    /** 磨砂层浓度：只负责提亮（深色下压暗），不能高到盖住模糊 */
    frostOpacity?: number;
}

/**
 * 毛玻璃底层：真实 backdrop 模糊（Android 走 dimezis BlurView），
 * 上面叠一层很淡的磨砂色。浅色用白、深色用接近 #1C1C1E 的灰，与 iOS 的材质一致。
 * 放在玻璃容器的第一个子节点，容器自身背景保持透明，模糊效果才不会被实色盖住。
 */
export default function GlassBackdrop(props: IGlassBackdropProps) {
    const dark = Theme.useTheme().dark;
    const {
        radius = rpx(18),
        intensity = 55,
        frostOpacity = dark ? 0.55 : 0.28,
    } = props;

    return (
        <View
            pointerEvents="none"
            style={[
                styles.root,
                dark ? styles.edgeDark : styles.edgeLight,
                { borderRadius: radius },
            ]}>
            <BlurView
                intensity={intensity}
                tint={dark ? "dark" : "light"}
                experimentalBlurMethod="dimezisBlurView"
                style={StyleSheet.absoluteFill}
            />
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor: dark
                            ? `rgba(30, 30, 32, ${frostOpacity})`
                            : `rgba(255, 255, 255, ${frostOpacity})`,
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth,
    },
    // 玻璃边缘的发丝高光：深色下要压得很淡，否则像描边
    edgeDark: {
        borderColor: "rgba(255, 255, 255, 0.1)",
    },
    edgeLight: {
        borderColor: "rgba(255, 255, 255, 0.55)",
    },
});
