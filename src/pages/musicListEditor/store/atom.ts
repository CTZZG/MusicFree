import { atom } from "jotai";

export interface IEditorMusicItem {
    musicItem: IMusic.IMusicItem;
    checked?: boolean;
}

/** 编辑页中的音乐条目 */
const editingMusicListAtom = atom<IEditorMusicItem[]>([]);
const editingMusicListBaselineAtom = atom<IMusic.IMusicItem[]>([]);

/** 是否变动过 */
const musicListChangedAtom = atom(false);

export {
    editingMusicListAtom,
    editingMusicListBaselineAtom,
    musicListChangedAtom,
};
