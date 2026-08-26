import { GlobalState } from "@/utils/stateMapper";
import { DeviceEventEmitter } from "react-native";
import type panels from "./types";

type IPanel = typeof panels;
type IPanelkeys = keyof IPanel;

interface IPanelInfo {
    name: IPanelkeys | null;
    payload: any;
    /**
     * 每次 showPanel 调用的唯一序号，给 Panels 渲染时当 key 用。
     *
     * 背景：SimpleSelect 等面板的条目 onPress 是先调用业务回调、回调里可能
     * 再 showPanel 打开下一个面板，然后才 hidePanel() 关自己。这意味着新
     * 面板的 showPanel 发生在旧面板还「显示中」的时候，会走 hidePanel 事件
     * 排队关闭、关闭动画结束后再切换 name/payload 这条路径。当新旧面板是
     * 同一个组件（比如 SimpleSelect 接 SimpleSelect，FAB 菜单点开 LX 音源
     * 导入子菜单就是这种情况）时，unmountPanel 里连续两次 setValue 会被
     * React 批处理成一次提交，reconciler 只看到同类型组件的 props 更新，
     * 不会真的卸载重挂——面板自己「只在挂载时跑一次」的显示动画/effect 就
     * 不会重新执行，新面板永远停在关闭态（离屏、看不见），但全屏遮罩
     * Pressable 依然渲染在最上层拦截所有触摸，界面看起来彻底卡死，只能
     * 强杀重开。加 seq 当 key 强制每次 showPanel 都是全新的组件实例，
     * 从根上避免"同类型面板接力时状态不重置"这类问题，不需要逐个面板改。
     */
    seq: number;
}

/** 浮层信息 */
export const panelInfoStore = new GlobalState<IPanelInfo>({
    name: null,
    payload: null,
    seq: 0,
});

let panelSeq = 0;

export function showPanel<T extends IPanelkeys>(
    name: T,
    payload?: Parameters<IPanel[T]>[0],
) {
    const seq = ++panelSeq;
    if (panelInfoStore.getValue().name) {
        DeviceEventEmitter.emit("hidePanel", () => {
            panelInfoStore.setValue({
                name,
                payload,
                seq,
            });
        });
    } else {
        panelInfoStore.setValue({
            name,
            payload,
            seq,
        });
    }
}

export function hidePanel() {
    DeviceEventEmitter.emit("hidePanel");
}
