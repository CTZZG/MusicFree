import React, { useEffect } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";

import rpx from "@/utils/rpx";

interface IPlayingIndicatorProps {
    active: boolean;
    color: string;
    size?: number;
    style?: StyleProp<ViewStyle>;
}

interface IBarConfig {
    delay: number;
    duration: number;
    idle: number;
    max: number;
    min: number;
}

const BAR_CONFIGS: IBarConfig[] = [
    {
        min: 0.18,
        max: 1,
        idle: 0.75,
        duration: 475,
        delay: 40,
    },
    {
        min: 0.3,
        max: 1,
        idle: 0.42,
        duration: 475,
        delay: 120,
    },
    {
        min: 0.14,
        max: 1,
        idle: 0.88,
        duration: 425,
        delay: 0,
    },
    {
        min: 0.35,
        max: 1,
        idle: 0.5,
        duration: 525,
        delay: 180,
    },
];

function getIdleProgress(config: IBarConfig) {
    return (config.idle - config.min) / Math.max(0.01, config.max - config.min);
}

function IndicatorBar(props: {
    active: boolean;
    color: string;
    config: IBarConfig;
    index: number;
    size: number;
}) {
    const { active, color, config, index, size } = props;
    const progress = useSharedValue(getIdleProgress(config));

    useEffect(() => {
        if (active) {
            progress.value = withDelay(
                config.delay,
                withRepeat(
                    withSequence(
                        withTiming(1, {
                            duration: config.duration,
                            easing: Easing.inOut(Easing.quad),
                        }),
                        withTiming(0, {
                            duration: config.duration,
                            easing: Easing.inOut(Easing.quad),
                        }),
                    ),
                    -1,
                    false,
                ),
            );
        } else {
            cancelAnimation(progress);
            progress.value = withTiming(getIdleProgress(config), {
                duration: 180,
                easing: Easing.out(Easing.quad),
            });
        }

        return () => {
            cancelAnimation(progress);
        };
    }, [active, config, progress]);

    const animatedStyle = useAnimatedStyle(() => ({
        height: size * (config.min + progress.value * (config.max - config.min)),
    }));

    return (
        <Animated.View
            style={[
                styles.bar,
                {
                    width: Math.max(rpx(3), size * 0.14),
                    borderRadius: Math.max(rpx(2), size * 0.07),
                    backgroundColor: color,
                    marginLeft: index === 0 ? 0 : Math.max(rpx(2), size * 0.1),
                    opacity: active ? 1 : 0.76,
                },
                animatedStyle,
            ]}
        />
    );
}

export default function PlayingIndicator(props: IPlayingIndicatorProps) {
    const { active, color, size = rpx(32), style } = props;

    return (
        <View
            pointerEvents="none"
            style={[
                styles.root,
                {
                    width: size,
                    height: size,
                },
                style,
            ]}>
            {BAR_CONFIGS.map((config, index) => (
                <IndicatorBar
                    key={`${config.duration}-${index}`}
                    active={active}
                    color={color}
                    config={config}
                    index={index}
                    size={size}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "center",
    },
    bar: {
        minHeight: rpx(4),
    },
});
