jest.mock("@/components/dialogs/useDialog", () => ({
    showDialog: jest.fn(),
}));

jest.mock("@/core/i18n", () => ({
    __esModule: true,
    default: {
        t: jest.fn((key: string) => key),
    },
}));

jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        warn: jest.fn(),
    },
}));

jest.mock("../action", () => ({
    saveEditingMusicSheet: jest.fn(),
}));

import { showDialog } from "@/components/dialogs/useDialog";
import Toast from "@/utils/toast";
import { getDefaultStore } from "jotai";
import { saveEditingMusicSheet } from "../action";
import {
    musicSheetChangedAtom,
    sheetEditorSavingAtom,
} from "../atom";
import {
    confirmSheetEditorTransition,
    saveEditingMusicSheetWithFeedback,
} from "../transition";

interface TestSimpleDialogProps {
    cancelText?: string;
    onOk?: () => void | Promise<void>;
    onCancel?: () => void;
    extraActions?: Array<{
        title: string;
        onPress?: () => void;
    }>;
}

function getShownDialog() {
    return mockedShowDialog.mock.calls[0]?.[1] as TestSimpleDialogProps;
}

const mockedShowDialog = jest.mocked(showDialog);

describe("sheet editor transitions", () => {
    const store = getDefaultStore();
    const mockedSave = jest.mocked(saveEditingMusicSheet);

    beforeEach(() => {
        jest.clearAllMocks();
        store.set(musicSheetChangedAtom, false);
        store.set(sheetEditorSavingAtom, false);
    });

    it("continues immediately when there are no unsaved changes", () => {
        const onContinue = jest.fn();

        confirmSheetEditorTransition(onContinue);

        expect(onContinue).toHaveBeenCalledTimes(1);
        expect(mockedShowDialog).not.toHaveBeenCalled();
    });

    it("offers save, discard, and cancel without losing the draft", () => {
        store.set(musicSheetChangedAtom, true);
        const onContinue = jest.fn();

        confirmSheetEditorTransition(onContinue);

        const dialog = getShownDialog();
        expect(dialog.cancelText).toBe("common.cancel");
        expect(dialog.extraActions?.[0].title).toBe("common.notSave");

        dialog.onCancel?.();
        expect(onContinue).not.toHaveBeenCalled();
        expect(store.get(musicSheetChangedAtom)).toBe(true);

        dialog.extraActions?.[0].onPress?.();
        expect(store.get(musicSheetChangedAtom)).toBe(false);
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it("continues only after a successful save", async () => {
        store.set(musicSheetChangedAtom, true);
        mockedSave.mockResolvedValueOnce(true);
        const onContinue = jest.fn();

        confirmSheetEditorTransition(onContinue);
        const dialog = getShownDialog();
        await dialog.onOk?.();

        expect(mockedSave).toHaveBeenCalledTimes(1);
        expect(Toast.success).toHaveBeenCalledWith("toast.saveSuccess");
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it("keeps the current editor open and reports a failed save", async () => {
        mockedSave.mockRejectedValueOnce(new Error("disk full"));

        await expect(saveEditingMusicSheetWithFeedback()).resolves.toBe(false);

        expect(Toast.warn).toHaveBeenCalledWith(
            "common.error: disk full",
        );
    });
});
