import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface IVerticalSafeAreaViewProps {
    mode?: "margin" | "padding";
    children: JSX.Element | JSX.Element[];
    style?: StyleProp<ViewStyle>;
}
/**
 * 页面的安全区：名字叫 Vertical，实际四边都让开（dfbd267 起）。
 *
 * react-native-safe-area-context 的 SafeAreaView 都按根上的 SafeAreaProvider
 * 取安全区、叠加在自己的内边距上，不管外层有没有让开过：里面再套
 * HorizontalSafeAreaView，左右就会让开两次（横屏时两边各多让 24～48 dp）。
 * 用了它，页面里就不要再给同一条边套安全区。
 */
export default function VerticalSafeAreaView(
    props: IVerticalSafeAreaViewProps,
) {
    const { children, style, mode } = props;
    return (
        <SafeAreaView
            style={style}
            mode={mode}
            edges={["top", "right", "bottom", "left"]}>
            {children}
        </SafeAreaView>
    );
}
