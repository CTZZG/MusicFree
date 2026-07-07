import React from "react";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import rpx from "@/utils/rpx";

interface IGlassBackdropProps {
    radius?: number;
    /** 模糊强度 0-100 */
    intensity?: number;
    /** 磨砂白浓度：只负责提亮，不能高到盖住模糊 */
    frostOpacity?: number;
}

/**
 * 毛玻璃底层：真实 backdrop 模糊（Android 走 dimezis BlurView），
 * 上面只叠一层很淡的磨砂白提亮。放在玻璃容器的第一个子节点，
 * 容器自身背景保持透明，模糊效果才不会被实色盖住。
 */
export default function GlassBackdrop(props: IGlassBackdropProps) {
    const { radius = rpx(18), intensity = 55, frostOpacity = 0.28 } = props;

    return (
        <View
            pointerEvents="none"
            style={[
                styles.root,
                {
                    borderRadius: radius,
                },
            ]}>
            <BlurView
                intensity={intensity}
                tint="light"
                experimentalBlurMethod="dimezisBlurView"
                style={StyleSheet.absoluteFill}
            />
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor: `rgba(255, 255, 255, ${frostOpacity})`,
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
        borderColor: "rgba(255, 255, 255, 0.55)",
    },
});
