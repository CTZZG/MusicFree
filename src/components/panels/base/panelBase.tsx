import useColors from "@/hooks/useColors";
import useOrientation from "@/hooks/useOrientation";
import rpx, { vh } from "@/utils/rpx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BackHandler,
    DeviceEventEmitter,
    Keyboard,
    NativeEventSubscription,
    Pressable,
    StyleSheet,
} from "react-native";
import Animated, {
    Easing,
    EasingFunction,
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { panelInfoStore } from "../usePanel";
import NativeUtils from "@/native/utils";
import { resolvePanelKeyboardOffset } from "./panelKeyboardPolicy";

const ANIMATION_EASING: EasingFunction = Easing.out(Easing.exp);
const ANIMATION_DURATION = 250;

const timingConfig = {
    duration: ANIMATION_DURATION,
    easing: ANIMATION_EASING,
};

interface IPanelBaseProps {
    keyboardAvoidBehavior?: "height" | "padding" | "position" | "none";
    height?: number;
    // 定位方式
    positionMethod?: "top" | "bottom";
    renderBody: (loading: boolean) => JSX.Element;
}

export default function (props: IPanelBaseProps) {
    const {
        height = vh(60),
        renderBody,
        keyboardAvoidBehavior,
        positionMethod = "bottom",
    } = props;
    const snapPoint = useSharedValue(0);
    const keyboardOffset = useSharedValue(0);
    const panelLayoutBottomRef = useRef(0);

    const colors = useColors();
    const [loading, setLoading] = useState(true); // 是否处于弹出状态
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    const safeAreaInsets = useSafeAreaInsets();
    const orientation = useOrientation();
    const useAnimatedBase = useMemo(
        () => (orientation === "horizontal" ? rpx(750) : height),
        [orientation],
    );

    const backHandlerRef = useRef<NativeEventSubscription | undefined>(
        undefined,
    );

    const hideCallbackRef = useRef<Function[]>([]);

    useEffect(() => {
        snapPoint.value = withTiming(1, timingConfig);

        timerRef.current = setTimeout(() => {
            if (loading) {
                // 兜底
                setLoading(false);
            }
        }, 400);
        if (backHandlerRef.current) {
            backHandlerRef.current.remove();
            backHandlerRef.current = undefined;
        }
        backHandlerRef.current = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                snapPoint.value = withTiming(0, timingConfig);
                return true;
            },
        );

        const listenerSubscription = DeviceEventEmitter.addListener(
            "hidePanel",
            (callback?: () => void) => {
                if (callback) {
                    hideCallbackRef.current.push(callback);
                }
                snapPoint.value = withTiming(0, timingConfig);
            },
        );

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
            if (backHandlerRef.current) {
                backHandlerRef.current?.remove();
                backHandlerRef.current = undefined;
            }
            listenerSubscription.remove();
        };
    }, []);

    // 面板绝对定位在根视图底部，`KeyboardAvoidingView` 量不到它的真实高度
    // （height 行为下 frame 高度为 0），所以这里按面板底边与键盘顶边的重叠量
    // 直接抬升面板，避免输入框被输入法盖住。onLayout 不受 transform 影响，
    // 因此弹出动画进行中拿到的也是最终位置。
    useEffect(() => {
        if (keyboardAvoidBehavior === "none" || orientation !== "vertical") {
            keyboardOffset.value = 0;
            return;
        }

        const applyKeyboardScreenY = (keyboardScreenY?: number | null) => {
            keyboardOffset.value = withTiming(
                resolvePanelKeyboardOffset({
                    panelBottomY: panelLayoutBottomRef.current,
                    keyboardScreenY: keyboardScreenY ?? 0,
                }),
                timingConfig,
            );
        };

        if (Keyboard.isVisible()) {
            applyKeyboardScreenY(Keyboard.metrics()?.screenY);
        }
        const showSubscription = Keyboard.addListener(
            "keyboardDidShow",
            event => {
                applyKeyboardScreenY(event?.endCoordinates?.screenY);
            },
        );
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            keyboardOffset.value = withTiming(0, timingConfig);
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
            keyboardOffset.value = 0;
        };
    }, [keyboardAvoidBehavior, keyboardOffset, orientation]);

    const maskAnimated = useAnimatedStyle(() => {
        return {
            opacity: snapPoint.value * 0.5,
        };
    });

    const panelAnimated = useAnimatedStyle(() => {
        return {
            transform: [
                orientation === "vertical"
                    ? {
                        translateY:
                            (1 - snapPoint.value) * useAnimatedBase -
                            keyboardOffset.value,
                    }
                    : {
                        translateX: (1 - snapPoint.value) * useAnimatedBase,
                    },
            ],
        };
    }, [orientation]);

    const mountPanel = useCallback(() => {
        setLoading(false);
    }, []);

    const unmountPanel = useCallback(() => {
        panelInfoStore.setValue(prev => ({
            name: null,
            payload: null,
            seq: prev.seq,
        }));
        hideCallbackRef.current.forEach(cb => cb?.());
    }, []);

    useAnimatedReaction(
        () => snapPoint.value,
        (result, prevResult) => {
            if (
                ((prevResult !== null && result > prevResult) ||
                    prevResult === null) &&
                result > 0.8
            ) {
                runOnJS(mountPanel)();
            }

            if (prevResult && result < prevResult && result === 0) {
                runOnJS(unmountPanel)();
            }
        },
        [],
    );

    const panelBody = (
        <Animated.View
            onLayout={event => {
                const layout = event.nativeEvent.layout;
                panelLayoutBottomRef.current = layout.y + layout.height;
            }}
            style={[
                style.wrapper,
                orientation === "horizontal" ? {
                    height: vh(100) - safeAreaInsets.top,
                    bottom: 0,
                } : {
                    top: positionMethod === "top" ? (NativeUtils.getWindowDimensions().height + safeAreaInsets.top) - height - safeAreaInsets.bottom : undefined,
                    bottom: positionMethod === "bottom" ? 0 : undefined,
                    height: height,
                },
                {
                    backgroundColor: colors.backdrop,
                },
                panelAnimated,
            ]}>
            {renderBody(loading)}
        </Animated.View>
    );

    return (
        <>
            <Pressable
                style={style.maskWrapper}
                onPress={() => {
                    snapPoint.value = withTiming(0, timingConfig);
                }}>
                <Animated.View
                    style={[style.maskWrapper, style.mask, maskAnimated]}
                />
            </Pressable>
            {panelBody}
        </>
    );
}

const style = StyleSheet.create({
    maskWrapper: {
        position: "absolute",
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 15000,
    },
    mask: {
        backgroundColor: "#000",
        opacity: 0.5,
    },
    wrapper: {
        position: "absolute",
        width: rpx(750),
        right: 0,
        borderTopLeftRadius: rpx(28),
        borderTopRightRadius: rpx(28),
        zIndex: 15010,
    },
});
