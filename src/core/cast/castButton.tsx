import React, { useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";

interface ILazyCastButtonProps {
    size?: number;
    color?: string;
    style?: StyleProp<ViewStyle>;
}

/**
 * `react-native-nitro-player` 的模块入口一被求值就会创建 HybridTrackPlayer /
 * HybridCast，它们的 init 会立刻 startService + bind NitroPlayerPlaybackService，
 * 把 ExoPlayer 和 Media3 MediaSession 建出来。投屏按钮只在 Nitro 后端且 Cast
 * 就绪时才渲染，所以把 require 推迟到那一刻，MPV 后端不会被牵连。
 */
export default function LazyCastButton(props: ILazyCastButtonProps) {
    const CastButton = useMemo(
        () =>
            (require("react-native-nitro-player") as
                typeof import("react-native-nitro-player")).CastButton,
        [],
    );
    return <CastButton {...props} />;
}
