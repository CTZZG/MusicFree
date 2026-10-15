import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Icon from "@/components/base/icon.tsx";

interface IBufferingPauseIconProps {
    /** 转圈的直径 */
    ringSize: number;
    /** 中间暂停图标的大小 */
    iconSize: number;
    color?: string;
}

/**
 * 加载、缓冲中的播放按钮内容：外圈转圈表示还在加载，中间的暂停表示可以按下暂停。
 * 按钮本身（Pressable、读屏标签、忙碌状态）由用的地方给。
 */
export default function BufferingPauseIcon(props: IBufferingPauseIconProps) {
    const { ringSize, iconSize, color } = props;
    return (
        <View style={[styles.container, { width: ringSize, height: ringSize }]}>
            <ActivityIndicator
                style={StyleSheet.absoluteFill}
                size={ringSize}
                color={color}
            />
            <Icon name="pause" size={iconSize} color={color} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        justifyContent: "center",
    },
});
