import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";

// 直接取原生视图，绕过库的 JS 包装器：包装器在 Android 上强制走
// "独立 popup 窗口 + overlay 双份渲染"，children 会脱离导航上下文导致崩溃。
// 这里只把原生玻璃面当作纯背景层（childless backdrop）使用，
// 配合补丁（patches/expo-liquid-glass-native）里的 canvas 捕获路径，
// 背景采样会自动排除本视图及其上层内容，主树里的内容照常交互。
// 透镜折射 shader（AGSL）需要 Android 13+。
let NativeLiquidGlass: React.ComponentType<any> | null = null;
if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    try {
        NativeLiquidGlass =
            require("expo-modules-core").requireNativeViewManager(
                "ExpoLiquidGlassNative",
            );
    } catch {}
}

export function isLiquidGlassAvailable() {
    return !!NativeLiquidGlass;
}

interface ILiquidGlassBackdropProps {
    radius?: number;
    /** 玻璃色调 */
    tint?: string;
    /** 模糊半径 dp，液态玻璃靠折射表现质感，模糊不需要大 */
    blurRadius?: number;
    /** 触发原生背景重采样；不要用 key 重挂载，否则切页/切歌会闪烁。 */
    refreshToken?: number;
}

export default function LiquidGlassBackdrop(props: ILiquidGlassBackdropProps) {
    const {
        radius = rpx(18),
        tint = "#FFFFFF",
        blurRadius = 6,
        refreshToken = 0,
    } = props;
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            setReady(true);
        });

        return () => {
            cancelAnimationFrame(frame);
        };
    }, []);

    if (!NativeLiquidGlass) {
        return null;
    }

    return (
        <View
            collapsable={false}
            pointerEvents="none"
            style={[
                styles.root,
                {
                    borderRadius: radius,
                },
            ]}>
            <View style={[StyleSheet.absoluteFill, styles.fallback]} />
            {ready ? (
                <NativeLiquidGlass
                    tint={tint}
                    blurRadius={blurRadius}
                    cornerRadius={radius + 1}
                    lensX={28}
                    lensY={24}
                    surfaceColor="rgba(255, 255, 255, 0.035)"
                    useRealtimeCapture={true}
                    refreshToken={refreshToken}
                    renderInSeparateWindow={false}
                    style={styles.nativeSurface}
                />
            ) : null}
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
    },
    nativeSurface: {
        position: "absolute",
        top: -1,
        right: -1,
        bottom: -1,
        left: -1,
    },
    fallback: {
        backgroundColor: "rgba(255, 255, 255, 0.16)",
    },
});
