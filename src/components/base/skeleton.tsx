import React, { useEffect } from "react";
import {
    DimensionValue,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";

interface ISkeletonProps {
    width?: DimensionValue;
    height?: number;
    borderRadius?: number;
    style?: StyleProp<ViewStyle>;
}

/** 单个骨架块：主题色 + 呼吸式透明度动画 */
export function Skeleton(props: ISkeletonProps) {
    const { width = "100%", height = rpx(28), borderRadius = rpx(8), style } =
        props;
    const colors = useColors();
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = withRepeat(
            withTiming(1, {
                duration: 850,
                easing: Easing.inOut(Easing.quad),
            }),
            -1,
            true,
        );
        return () => {
            cancelAnimation(progress);
        };
    }, [progress]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: 0.35 + progress.value * 0.4,
    }));

    return (
        <Animated.View
            style={[
                {
                    width,
                    height,
                    borderRadius,
                    backgroundColor:
                        colors.placeholder ?? "rgba(128, 128, 128, 0.2)",
                },
                animatedStyle,
                style,
            ]}
        />
    );
}

/** 模拟一行媒体列表项（封面 + 两行文字）的骨架 */
export function SkeletonListItem() {
    return (
        <View style={styles.row}>
            <Skeleton width={rpx(68)} height={rpx(68)} borderRadius={rpx(12)} />
            <View style={styles.rowText}>
                <Skeleton width="62%" height={rpx(30)} />
                <Skeleton
                    width="40%"
                    height={rpx(24)}
                    style={styles.secondLine}
                />
            </View>
        </View>
    );
}

/** 列表加载占位：若干行媒体骨架 */
export function ListSkeleton(props: { count?: number }) {
    const { count = 8 } = props;
    return (
        <View style={styles.list}>
            {Array.from({ length: count }).map((_, index) => (
                <SkeletonListItem key={index} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    list: {
        width: "100%",
    },
    row: {
        height: rpx(120),
        paddingHorizontal: rpx(24),
        flexDirection: "row",
        alignItems: "center",
    },
    rowText: {
        flex: 1,
        marginLeft: rpx(20),
    },
    secondLine: {
        marginTop: rpx(16),
    },
});
