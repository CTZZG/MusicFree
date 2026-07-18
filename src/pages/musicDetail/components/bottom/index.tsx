import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import SeekBar from "./seekBar";
import PlayControl from "./playControl";
import useOrientation from "@/hooks/useOrientation";
import { SharedValue } from "react-native-reanimated";
import { PORTRAIT_GESTURE_EXTENSION } from "./layout";

interface IBottomProps {
    swipeProgress: SharedValue<number>;
}

export default function Bottom(props: IBottomProps) {
    const { swipeProgress } = props;
    const orientation = useOrientation();
    if (orientation === "horizontal") {
        return (
            <View style={[style.wrapper, style.horizontalWrapper]}>
                <SeekBar />
                <PlayControl swipeProgress={swipeProgress} />
            </View>
        );
    }

    return (
        <View style={[style.wrapper, style.portraitWrapper]}>
            <SeekBar />
            <PlayControl swipeProgress={swipeProgress} />
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
    },
    horizontalWrapper: {
        height: rpx(156),
    },
    portraitWrapper: {
        height: rpx(240 + PORTRAIT_GESTURE_EXTENSION),
        marginBottom: rpx(-PORTRAIT_GESTURE_EXTENSION),
        transform: [{ translateY: rpx(-PORTRAIT_GESTURE_EXTENSION) }],
    },
});
