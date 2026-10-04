import React, { createContext, PropsWithChildren, useContext } from "react";
import { useWindowDimensions } from "react-native";

const FollowSystemFontScaleContext = createContext(false);

/**
 * ThemeText 是否跟随系统字体放大。
 *
 * 目标是全部跟随系统字体（直接用 Text 的地方本来就跟随）。ThemeText 以前一律
 * 关掉了缩放，各页面没有在 1.3～2 倍下核对过，所以按页面、面板逐个放开：核对过
 * 的登记在 src/constants/fontScaleMigration.ts，入口给这些路由和面板包一层
 * followSystem 的 FontScaleScope。没登记的地方保持原样，不放大。
 */
export function FontScaleScope(
    props: PropsWithChildren<{ followSystem: boolean }>,
) {
    return (
        <FollowSystemFontScaleContext.Provider value={props.followSystem}>
            {props.children}
        </FollowSystemFontScaleContext.Provider>
    );
}

export function useFollowSystemFontScale() {
    return useContext(FollowSystemFontScaleContext);
}

/**
 * ThemeText 实际的放大倍数：跟随系统字体时是系统字体的倍数，否则是 1。
 * 宽度要跟着文字一起放大的地方（例如歌曲行里的时长）用它，没迁移的页面里不会
 * 白白变宽。
 */
export function useThemeTextFontScale() {
    const followSystem = useFollowSystemFontScale();
    const { fontScale } = useWindowDimensions();
    return followSystem ? fontScale : 1;
}
