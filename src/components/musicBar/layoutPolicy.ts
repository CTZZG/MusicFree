export interface IMusicBarLayoutPolicyInput {
    routeSupportsMusicBar: boolean;
    /** 当前页面是带底部标签栏的主页 */
    routeHasTabBar: boolean;
    hasCurrentMusic: boolean;
    keyboardVisible: boolean;
    barHeight: number;
    floatingBottom: number;
    tabBarHeight: number;
    /** 迷你播放器与标签栏之间的间距 */
    tabBarGap: number;
}

export interface IMusicBarLayoutPolicyResult {
    visible: boolean;
    /** 标签栏是否显示：键盘弹出时收起，免得被顶到键盘上面 */
    tabBarVisible: boolean;
    /** 迷你播放器底边离安全区底部的距离 */
    barBottom: number;
    /** 页面内容底部要让出的高度（从安全区底部算起），让标签栏与迷你播放器不挡内容 */
    reservedBottom: number;
}

export function resolveMusicBarLayout(
    input: IMusicBarLayoutPolicyInput,
): IMusicBarLayoutPolicyResult {
    const tabBarVisible = input.routeHasTabBar && !input.keyboardVisible;
    const tabBarReserved = tabBarVisible
        ? input.floatingBottom + input.tabBarHeight
        : 0;
    const barBottom = tabBarVisible
        ? tabBarReserved + input.tabBarGap
        : input.floatingBottom;
    const visible =
        input.routeSupportsMusicBar &&
        input.hasCurrentMusic &&
        !input.keyboardVisible;

    return {
        visible,
        tabBarVisible,
        barBottom,
        reservedBottom: visible ? barBottom + input.barHeight : tabBarReserved,
    };
}
