jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        setSortedSheets: jest.fn(),
        setStarredMusicSheets: jest.fn(),
    },
}));

import MusicSheet from "@/core/musicSheet";
import { getDefaultStore } from "jotai";
import { beginSheetTypeChange, saveEditingMusicSheet } from "../action";
import {
    editingMusicSheetAtom,
    loadedSheetTypeAtom,
    musicSheetChangedAtom,
    sheetEditorSavingAtom,
    sheetTypeAtom,
} from "../atom";

const localSheet = {
    id: "local-sheet",
    platform: "local",
    title: "Local",
} as IMusic.IMusicSheetItemBase;

describe("sheet editor actions", () => {
    const store = getDefaultStore();
    const setSortedSheets = jest.mocked(MusicSheet.setSortedSheets);
    const setStarredMusicSheets = jest.mocked(
        MusicSheet.setStarredMusicSheets,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        store.set(sheetTypeAtom, "local");
        store.set(loadedSheetTypeAtom, "local");
        store.set(editingMusicSheetAtom, [{ musicSheetItem: localSheet }]);
        store.set(musicSheetChangedAtom, true);
        store.set(sheetEditorSavingAtom, false);
    });

    it("waits for persistence before clearing dirty state", async () => {
        let resolveWrite!: () => void;
        setSortedSheets.mockReturnValueOnce(
            new Promise<void>(resolve => {
                resolveWrite = resolve;
            }),
        );

        const saving = saveEditingMusicSheet();

        expect(store.get(sheetEditorSavingAtom)).toBe(true);
        expect(store.get(musicSheetChangedAtom)).toBe(true);
        resolveWrite();
        await expect(saving).resolves.toBe(true);
        expect(store.get(musicSheetChangedAtom)).toBe(false);
        expect(store.get(sheetEditorSavingAtom)).toBe(false);
    });

    it("keeps dirty state when persistence fails", async () => {
        setSortedSheets.mockRejectedValueOnce(new Error("disk full"));

        await expect(saveEditingMusicSheet()).rejects.toThrow("disk full");

        expect(store.get(musicSheetChangedAtom)).toBe(true);
        expect(store.get(sheetEditorSavingAtom)).toBe(false);
    });

    it("rejects stale data that belongs to another tab", async () => {
        store.set(sheetTypeAtom, "starred");
        store.set(loadedSheetTypeAtom, "local");

        await expect(saveEditingMusicSheet()).rejects.toThrow(
            "does not match",
        );
        expect(setSortedSheets).not.toHaveBeenCalled();
        expect(setStarredMusicSheets).not.toHaveBeenCalled();
        expect(store.get(musicSheetChangedAtom)).toBe(true);
    });

    it("persists starred sheets through the starred backend", async () => {
        const starredSheet = {
            ...localSheet,
            id: "starred-sheet",
            musicList: [],
        } as IMusic.IMusicSheetItem;
        store.set(sheetTypeAtom, "starred");
        store.set(loadedSheetTypeAtom, "starred");
        store.set(editingMusicSheetAtom, [{ musicSheetItem: starredSheet }]);
        setStarredMusicSheets.mockResolvedValueOnce(undefined);

        await expect(saveEditingMusicSheet()).resolves.toBe(true);

        expect(setStarredMusicSheets).toHaveBeenCalledWith([starredSheet]);
        expect(setSortedSheets).not.toHaveBeenCalled();
    });

    it("invalidates old editor data before selecting a new tab", () => {
        beginSheetTypeChange("starred");

        expect(store.get(sheetTypeAtom)).toBe("starred");
        expect(store.get(loadedSheetTypeAtom)).toBeNull();
        expect(store.get(editingMusicSheetAtom)).toEqual([]);
        expect(store.get(musicSheetChangedAtom)).toBe(false);
    });
});
