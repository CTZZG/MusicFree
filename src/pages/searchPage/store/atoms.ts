import { atom } from "jotai";

/** 搜索页展示的面板；搜索结果本身由 @/core/search 的搜索会话维护 */
export enum PageStatus {
    /** 编辑中 */
    EDITING = "EDITING",
    /** 搜索中 */
    SEARCHING = "SEARCHING",
    /** 有结果 */
    RESULT = "RESULT",
    /** 没有安装插件 */
    NO_PLUGIN = "NO_PLUGIN",
}

/** 是否正在编辑搜索词（展示搜索历史） */
const editingAtom = atom(true);

/** 输入框中的搜索词 */
const queryAtom = atom<string>("");

export { editingAtom, queryAtom };
