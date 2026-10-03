import React, { RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import rpx from "@/utils/rpx";
import Theme from "@/core/theme";
import { getGlassMaterial } from "./glassMaterial";

interface IGlassBackdropProps {
    radius?: number;
    /** 模糊强度 0-100 */
    intensity?: number;
    /**
     * 要模糊的内容：包着它的 BlurTargetView 的 ref。玻璃本身必须在这个
     * BlurTargetView 外面，否则会把自己也录进模糊里。不传就没有真模糊，
     * 改用接近不透明的磨砂底。
     */
    blurTarget?: RefObject<View | null>;
}

/**
 * 毛玻璃底层：真实 backdrop 模糊（Android 12+ 走 dimezis BlurView），上面叠一层
 * 磨砂色。浅色用接近 #F9F9F9 的白、深色用接近 #1C1C1E 的灰，与 iOS 的材质一致。
 * 不能模糊时（Android 12 以下，或没有模糊目标）磨砂层几乎不透明，见 glassMaterial。
 * 放在玻璃容器的第一个子节点，容器自身背景保持透明。
 */
export default function GlassBackdrop(props: IGlassBackdropProps) {
    const dark = Theme.useTheme().dark;
    const { radius = rpx(18), intensity = 55, blurTarget } = props;
    const material = getGlassMaterial({
        dark,
        platform: Platform.OS,
        platformVersion: Platform.Version,
        hasBlurTarget: !!blurTarget,
    });

    return (
        <View
            pointerEvents="none"
            style={[
                styles.root,
                dark ? styles.edgeDark : styles.edgeLight,
                { borderRadius: radius },
            ]}>
            {material.blur ? (
                <BlurView
                    blurTarget={blurTarget}
                    intensity={intensity}
                    tint={dark ? "dark" : "light"}
                    blurMethod="dimezisBlurViewSdk31Plus"
                    style={StyleSheet.absoluteFill}
                />
            ) : null}
            <View
                style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: material.frostColor },
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
