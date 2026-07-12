import { atom } from "jotai";

export type SheetEditorType = "local" | "starred";

export interface IEditorMusicSheetItem {
    musicSheetItem: IMusic.IMusicSheetItemBase;
    checked?: boolean;
}

/** 编辑页中的音乐条目 */
const editingMusicSheetAtom = atom<IEditorMusicSheetItem[]>([]);

/** 是否变动过 */
const musicSheetChangedAtom = atom(false);

/** 本地歌单还是收藏歌单 */
const sheetTypeAtom = atom<SheetEditorType>("local");

/** 当前编辑数据实际对应的标签；null 表示正在切换或尚未加载 */
const loadedSheetTypeAtom = atom<SheetEditorType | null>(null);

/** 保存过程中锁定编辑与标签切换，避免保存快照再次变化 */
const sheetEditorSavingAtom = atom(false);

const sheetEditorReadyAtom = atom(
    get =>
        get(loadedSheetTypeAtom) === get(sheetTypeAtom) &&
        !get(sheetEditorSavingAtom),
);

export {
    editingMusicSheetAtom,
    loadedSheetTypeAtom,
    musicSheetChangedAtom,
    sheetEditorReadyAtom,
    sheetEditorSavingAtom,
    sheetTypeAtom,
};
