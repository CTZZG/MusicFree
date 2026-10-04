import rpx from "@/utils/rpx";
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    interpolateColor,
    runOnJS,
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import Icon from "@/components/base/icon.tsx";
import { timingConfig } from "@/constants/commonConst";
import { maxFontScaleConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import TrackPlayer, { useMusicState } from "@/core/trackPlayer";
import useOrientation from "@/hooks/useOrientation";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import {
    getSwipeUpFeedbackProgress,
    shouldTriggerSwipeUpNext,
    SWIPE_UP_ACTIVATION_DISTANCE,
    SWIPE_UP_MAX_HORIZONTAL_DRIFT,
} from "./swipeNextPolicy";

const SWIPE_SUCCESS_FEEDBACK_PROGRESS = 1.8;
const SWIPE_SUCCESS_ANIMATION = {
    duration: 220,
    easing: Easing.out(Easing.cubic),
};
const SWIPE_RESET_ANIMATION = {
    duration: 320,
    easing: Easing.out(Easing.cubic),
};
const CHEVRON_PULSE_ANIMATION = {
    duration: 680,
    easing: Easing.inOut(Easing.quad),
};

interface IPlayControlProps {
    swipeProgress: SharedValue<number>;
}

function skipToNextFromSwipe() {
    TrackPlayer.skipToNext().catch(() => undefined);
}

export default function PlayControl(props: IPlayControlProps) {
    const { swipeProgress } = props;
    const musicState = useMusicState();
    const { t } = useI18N();

    const orientation = useOrientation();
    const feedbackCompleting = useSharedValue(0);
    const chevronPulse = useSharedValue(0);
    const hintLift = rpx(5);

    useEffect(() => {
        cancelAnimation(chevronPulse);
        if (orientation === "horizontal") {
            chevronPulse.value = 0;
            return;
        }

        chevronPulse.value = withRepeat(
            withTiming(1, CHEVRON_PULSE_ANIMATION),
            -1,
            true,
        );

        return () => {
            cancelAnimation(chevronPulse);
        };
    }, [chevronPulse, orientation]);

    useEffect(() => {
        if (orientation === "horizontal") {
            cancelAnimation(swipeProgress);
            swipeProgress.value = 0;
            feedbackCompleting.value = 0;
        }

        return () => {
            cancelAnimation(swipeProgress);
            swipeProgress.value = 0;
            feedbackCompleting.value = 0;
        };
    }, [feedbackCompleting, orientation, swipeProgress]);

    const hintAnimatedStyle = useAnimatedStyle(() => {
        const progress = Math.min(1, swipeProgress.value);
        return {
            backgroundColor: interpolateColor(
                progress,
                [0, 1],
                ["rgba(255,255,255,0)", "rgba(255,255,255,0.2)"],
            ),
            transform: [
                { translateY: -progress * hintLift },
                { scale: 1 + progress * 0.05 },
            ],
        };
    }, [hintLift, swipeProgress]);
    const hintTextAnimatedStyle = useAnimatedStyle(
        () => ({
            opacity: 0.68 + Math.min(1, swipeProgress.value) * 0.32,
        }),
        [swipeProgress],
    );
    const upperChevronAnimatedStyle = useAnimatedStyle(
        () => ({
            opacity: 0.12 + chevronPulse.value * 0.88,
            transform: [{ scale: 0.96 + chevronPulse.value * 0.04 }],
        }),
        [chevronPulse],
    );
    const lowerChevronAnimatedStyle = useAnimatedStyle(
        () => ({
            opacity: 1 - chevronPulse.value * 0.88,
            transform: [{ scale: 1 - chevronPulse.value * 0.04 }],
        }),
        [chevronPulse],
    );
    const swipeUpGesture = Gesture.Pan()
        .minPointers(1)
        .maxPointers(1)
        .activeOffsetY([-SWIPE_UP_ACTIVATION_DISTANCE, 100000])
        .failOffsetX([
            -SWIPE_UP_MAX_HORIZONTAL_DRIFT,
            SWIPE_UP_MAX_HORIZONTAL_DRIFT,
        ])
        .onBegin(() => {
            if (!feedbackCompleting.value) {
                swipeProgress.value = 0;
            }
        })
        .onUpdate(event => {
            if (feedbackCompleting.value) {
                return;
            }
            swipeProgress.value = getSwipeUpFeedbackProgress(
                event.translationY,
            );
        })
        .onEnd(event => {
            if (feedbackCompleting.value) {
                return;
            }
            const shouldSkip = shouldTriggerSwipeUpNext({
                translationX: event.translationX,
                translationY: event.translationY,
                velocityX: event.velocityX,
                velocityY: event.velocityY,
            });
            if (!shouldSkip) {
                swipeProgress.value = withTiming(0, timingConfig.animationFast);
                return;
            }

            feedbackCompleting.value = 1;
            swipeProgress.value = withTiming(
                SWIPE_SUCCESS_FEEDBACK_PROGRESS,
                SWIPE_SUCCESS_ANIMATION,
                finished => {
                    if (!finished) {
                        feedbackCompleting.value = 0;
                        swipeProgress.value = 0;
                        return;
                    }
                    runOnJS(skipToNextFromSwipe)();
                    swipeProgress.value = withTiming(
                        0,
                        SWIPE_RESET_ANIMATION,
                        () => {
                            feedbackCompleting.value = 0;
                        },
                    );
                },
            );
        })
        .onFinalize((_event, success) => {
            if (!success && !feedbackCompleting.value) {
                swipeProgress.value = withTiming(0, timingConfig.animationFast);
            }
        });

    const paused = musicIsPaused(musicState);
    // 上一首、播放/暂停、下一首居中排开；播放模式和播放列表在下面的操作栏
    const controls = (
        <View
            style={[
                styles.wrapper,
                orientation === "horizontal" ? styles.horizontalWrapper : null,
            ]}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("musicDetail.playControl.previous.a11y")}
                onPress={() => {
                    TrackPlayer.skipToPrevious().catch(() => undefined);
                }}
                style={({ pressed }) => [
                    styles.sideButton,
                    pressed ? styles.pressed : null,
                ]}>
                <Icon color="white" name="skip-left" size={36} />
            </Pressable>
            {musicIsBuffering(musicState) ? (
                <View style={styles.mainButton}>
                    <ActivityIndicator size="large" color="white" />
                </View>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        paused
                            ? t("common.play")
                            : t("musicDetail.playControl.pause.a11y")
                    }
                    onPress={() => {
                        if (paused) {
                            TrackPlayer.play();
                        } else {
                            TrackPlayer.pause();
                        }
                    }}
                    style={({ pressed }) => [
                        styles.mainButton,
                        pressed ? styles.pressed : null,
                    ]}>
                    <Icon
                        color="white"
                        name={paused ? "play" : "pause"}
                        size={52}
                    />
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("musicDetail.playControl.next.a11y")}
                onPress={() => {
                    TrackPlayer.skipToNext().catch(() => undefined);
                }}
                style={({ pressed }) => [
                    styles.sideButton,
                    pressed ? styles.pressed : null,
                ]}>
                <Icon color="white" name="skip-right" size={36} />
            </Pressable>
        </View>
    );

    if (orientation === "horizontal") {
        return controls;
    }

    return (
        <GestureDetector gesture={swipeUpGesture}>
            <View style={styles.gestureArea}>
                {controls}
                <Animated.View
                    pointerEvents="none"
                    style={[styles.swipeHint, hintAnimatedStyle]}>
                    <View style={styles.swipeHintChevrons}>
                        <Animated.View
                            style={[
                                styles.swipeHintChevron,
                                styles.swipeHintUpperChevron,
                                upperChevronAnimatedStyle,
                            ]}>
                            <Icon
                                color="white"
                                name="chevron-right"
                                size={rpx(20)}
                                style={styles.swipeHintIcon}
                            />
                        </Animated.View>
                        <Animated.View
                            style={[
                                styles.swipeHintChevron,
                                styles.swipeHintLowerChevron,
                                lowerChevronAnimatedStyle,
                            ]}>
                            <Icon
                                color="white"
                                name="chevron-right"
                                size={rpx(20)}
                                style={styles.swipeHintIcon}
                            />
                        </Animated.View>
                    </View>
                    <Animated.Text
                        maxFontSizeMultiplier={maxFontScaleConst.compact}
                        style={[styles.swipeHintText, hintTextAnimatedStyle]}>
                        上滑切换下一首
                    </Animated.Text>
                </Animated.View>
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: 84,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 40,
    },
    horizontalWrapper: {
        height: 64,
        paddingHorizontal: 24,
    },
    sideButton: {
        width: 64,
        height: 64,
        alignItems: "center",
        justifyContent: "center",
    },
    mainButton: {
        width: 80,
        height: 80,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.5,
    },
    // 父容器高度随内容走，这里不能用 flex: 1，否则会被压成 0 高
    gestureArea: {
        width: "100%",
    },
    swipeHint: {
        minHeight: rpx(68),
        marginTop: rpx(2),
        paddingHorizontal: rpx(18),
        paddingVertical: rpx(3),
        alignSelf: "center",
        borderRadius: rpx(24),
        alignItems: "center",
        justifyContent: "center",
    },
    swipeHintChevrons: {
        width: rpx(28),
        height: rpx(30),
        position: "relative",
    },
    swipeHintChevron: {
        position: "absolute",
        left: rpx(4),
    },
    swipeHintUpperChevron: {
        top: 0,
    },
    swipeHintLowerChevron: {
        top: rpx(13),
    },
    swipeHintIcon: {
        transform: [{ rotate: "-90deg" }],
    },
    swipeHintText: {
        color: "white",
        fontSize: rpx(22),
        lineHeight: rpx(28),
        includeFontPadding: false,
    },
});
