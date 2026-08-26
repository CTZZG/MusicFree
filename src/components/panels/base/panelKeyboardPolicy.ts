export interface IPanelKeyboardOffsetInput {
    /** 面板底边在窗口坐标系中的位置（dp） */
    panelBottomY: number;
    /** 键盘顶边在窗口坐标系中的位置（dp），即 endCoordinates.screenY */
    keyboardScreenY: number;
}

/**
 * 面板是绝对定位在根视图底部的，`KeyboardAvoidingView` 的 height/position 行为
 * 都量不到它的真实高度，所以这里直接按「面板底边与键盘顶边的重叠量」抬升。
 *
 * 这样无论系统是否真的 resize 了窗口（edge-to-edge 下 adjustResize 通常不会
 * 生效），结果都是自洽的：窗口已经被压缩时重叠量自然为 0，不会重复抬升。
 */
export function resolvePanelKeyboardOffset(
    input: IPanelKeyboardOffsetInput,
): number {
    const { panelBottomY, keyboardScreenY } = input;
    if (
        !Number.isFinite(panelBottomY) ||
        !Number.isFinite(keyboardScreenY) ||
        keyboardScreenY <= 0
    ) {
        return 0;
    }
    return Math.max(0, panelBottomY - keyboardScreenY);
}
