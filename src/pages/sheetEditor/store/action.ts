import { getDefaultStore } from "jotai";
import {
    editingMusicSheetAtom,
    loadedSheetTypeAtom,
    musicSheetChangedAtom,
    sheetEditorSavingAtom,
    sheetTypeAtom,
    SheetEditorType,
} from "./atom";
import MusicSheet from "@/core/musicSheet";

export function beginSheetTypeChange(nextType: SheetEditorType) {
    const store = getDefaultStore();
    store.set(loadedSheetTypeAtom, null);
    store.set(editingMusicSheetAtom, []);
    store.set(musicSheetChangedAtom, false);
    store.set(sheetTypeAtom, nextType);
}

export async function saveEditingMusicSheet(): Promise<boolean> {
    const store = getDefaultStore();
    const isDirty = store.get(musicSheetChangedAtom);
    if (!isDirty) {
        return true;
    }

    const currentTab = store.get(sheetTypeAtom);
    const loadedTab = store.get(loadedSheetTypeAtom);
    if (loadedTab !== currentTab) {
        throw new Error("Playlist editor data does not match the selected tab");
    }
    if (store.get(sheetEditorSavingAtom)) {
        return false;
    }

    const editingSnapshot = store.get(editingMusicSheetAtom);
    const editingSheets = editingSnapshot.map(it => it.musicSheetItem);
    store.set(sheetEditorSavingAtom, true);
    try {
        if (currentTab === "starred") {
            await MusicSheet.setStarredMusicSheets(
                editingSheets as IMusic.IMusicSheetItem[],
            );
        } else {
            await MusicSheet.setSortedSheets(editingSheets);
        }

        const snapshotIsStillCurrent =
            store.get(sheetTypeAtom) === currentTab &&
            store.get(loadedSheetTypeAtom) === loadedTab &&
            store.get(editingMusicSheetAtom) === editingSnapshot;
        if (snapshotIsStillCurrent) {
            store.set(musicSheetChangedAtom, false);
        }
        return snapshotIsStillCurrent;
    } finally {
        store.set(sheetEditorSavingAtom, false);
    }
}
