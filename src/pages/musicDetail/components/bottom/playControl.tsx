import rpx from "@/utils/rpx";
import React, { useEffect } from "react";
import {
    ActivityIndicator,
    InteractionManager,
    StyleSheet,
    View,
} from "react-native";
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
import { showPanel } from "@/components/panels/usePanel";
import { timingConfig } from "@/constants/commonConst";
import TrackPlayer, { useMusicState, useRepeatMode } from "@/core/trackPlayer";
import useOrientation from "@/hooks/useOrientation";
import delay from "@/utils/delay";
import { musicIsBuffering, musicIsPaused } from "@/utils/trackUtils";
import { MusicRepeatModeInfo } from "@/constants/trackPlayerConst";
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
    const repeatMode = useRepeatMode();
    const musicState = useMusicState();

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

    const controls = (
        <View
            style={[
                styles.wrapper,
                orientation === "horizontal" ? styles.marginTop0 : null,
            ]}>
            <Icon
                color={"white"}
                name={MusicRepeatModeInfo[repeatMode].icon}
                size={rpx(56)}
                onPress={async () => {
                    InteractionManager.runAfterInteractions(async () => {
                        await delay(20, false);
                        TrackPlayer.toggleRepeatMode();
                    });
                }}
            />
            <Icon
                color={"white"}
                name={"skip-left"}
                size={rpx(56)}
                onPress={() => {
                    TrackPlayer.skipToPrevious().catch(() => undefined);
                }}
            />
            {musicIsBuffering(musicState) ? (
                <View style={styles.indicatorContainer}>
                    <ActivityIndicator size={rpx(72)} color={"white"} />
                </View>
            ) : (
                <Icon
                    color={"white"}
                    name={musicIsPaused(musicState) ? "play" : "pause"}
                    size={rpx(96)}
                    onPress={() => {
                        if (musicIsPaused(musicState)) {
                            TrackPlayer.play();
                        } else {
                            TrackPlayer.pause();
                        }
                    }}
                />
            )}
            <Icon
                color={"white"}
                name={"skip-right"}
                size={rpx(56)}
                onPress={() => {
                    TrackPlayer.skipToNext().catch(() => undefined);
                }}
            />
            <Icon
                color={"white"}
                name={"playlist"}
                size={rpx(56)}
                onPress={() => {
                    showPanel("PlayList");
                }}
            />
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
        height: rpx(100),
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
    },
    gestureArea: {
        width: "100%",
        flex: 1,
    },
    indicatorContainer: {
        width: rpx(96),
        height: rpx(96),
        justifyContent: "center",
        alignItems: "center",
    },
    marginTop0: {
        marginTop: 0,
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
