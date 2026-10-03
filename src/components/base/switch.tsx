import React, { useEffect } from "react";
import {
    StyleSheet,
    SwitchProps,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { timingConfig } from "@/constants/commonConst";
import Theme from "@/core/theme";

interface ISwitchProps extends SwitchProps {}

// iOS 开关尺寸：51×31 的轨道，27 的圆钮
const TRACK_WIDTH = 51;
const TRACK_HEIGHT = 31;
const THUMB_SIZE = 27;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_INSET * 2;

export default function ThemeSwitch(props: ISwitchProps) {
    const { value, onValueChange, accessibilityLabel } = props;
    const dark = Theme.useTheme().dark;

    const sharedValue = useSharedValue(value ? 1 : 0);

    useEffect(() => {
        sharedValue.value = value ? 1 : 0;
    }, [sharedValue, value]);

    const thumbStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    translateX: withTiming(
                        sharedValue.value * THUMB_TRAVEL,
                        timingConfig.animationNormal,
                    ),
                },
            ],
        };
    });

    const onColor = dark ? "#30D158" : "#34C759";
    const offColor = dark
        ? "rgba(120, 120, 128, 0.32)"
        : "rgba(120, 120, 128, 0.16)";

    return (
        <TouchableWithoutFeedback
            onPress={() => {
                onValueChange?.(!value);
            }}
            accessibilityRole="switch"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: !!value }}>
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: value ? onColor : offColor,
                    },
                    props?.style,
                ]}>
                <Animated.View style={[styles.thumb, thumbStyle]} />
            </View>
        </TouchableWithoutFeedback>
    );
}

const styles = StyleSheet.create({
    container: {
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
        justifyContent: "center",
    },
    thumb: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: THUMB_SIZE / 2,
        backgroundColor: "white",
        left: THUMB_INSET,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 3,
    },
});
