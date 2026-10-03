import React, { memo } from "react";
import { StatusBar, StyleSheet, useWindowDimensions, View } from "react-native";
import Image from "./image";
import useColors from "@/hooks/useColors";
import Theme from "@/core/theme";

interface IPageBackgroundProps {
    /** 是否铺用户设置的背景图；只有首页显示，其余页面用纯色底 */
    showCustomImage?: boolean;
}

function PageBackground(props: IPageBackgroundProps) {
    const { showCustomImage = false } = props;
    const background = Theme.useBackground();
    const { height: windowHeight } = useWindowDimensions();
    const colors = useColors();

    // https://github.com/facebook/react-native/issues/41918
    const height = windowHeight + (StatusBar.currentHeight ?? 0);

    return (
        <View
            pointerEvents="none"
            style={[style.wrapper, { height }]}
        >
            <View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        backgroundColor:
                            colors?.pageBackground ?? colors.background,
                    },
                ]}
            />
            {showCustomImage && background?.url ? (
                <Image
                    uri={background.url}
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            opacity: background.opacity ?? 0.6,
                        },
                    ]}
                    blurRadius={background.blur ?? 20}
                />
            ) : null}
        </View>
    );
}

export default memo(
    PageBackground,
    (prev, next) => prev.showCustomImage === next.showCustomImage,
);

const style = StyleSheet.create({
    wrapper: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
    },
});
