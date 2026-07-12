import { showDialog } from "@/components/dialogs/useDialog";
import i18n from "@/core/i18n";
import Toast from "@/utils/toast";
import { getDefaultStore } from "jotai";
import { saveEditingMusicSheet } from "./action";
import {
    musicSheetChangedAtom,
    sheetEditorSavingAtom,
} from "./atom";

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export async function saveEditingMusicSheetWithFeedback() {
    try {
        const savedCurrentSnapshot = await saveEditingMusicSheet();
        if (!savedCurrentSnapshot) {
            Toast.warn(i18n.t("toast.rememberToSave"));
            return false;
        }
        Toast.success(i18n.t("toast.saveSuccess"));
        return true;
    } catch (error) {
        Toast.warn(
            `${i18n.t("common.error")}: ${getErrorMessage(error)}`,
        );
        return false;
    }
}

export function confirmSheetEditorTransition(onContinue: () => void) {
    const store = getDefaultStore();
    if (store.get(sheetEditorSavingAtom)) {
        return;
    }
    if (!store.get(musicSheetChangedAtom)) {
        onContinue();
        return;
    }

    showDialog("SimpleDialog", {
        title: i18n.t("dialog.simpleDialog.hasUnsavedChange.title"),
        content: i18n.t("dialog.simpleDialog.hasUnsavedChange.content"),
        okText: i18n.t("common.save"),
        cancelText: i18n.t("common.cancel"),
        async onOk() {
            if (await saveEditingMusicSheetWithFeedback()) {
                onContinue();
            }
        },
        onCancel() {
            // 取消：保留当前标签和编辑现场。
        },
        extraActions: [{
            title: i18n.t("common.notSave"),
            closeOnPress: true,
            onPress() {
                store.set(musicSheetChangedAtom, false);
                onContinue();
            },
        }],
    });
}
