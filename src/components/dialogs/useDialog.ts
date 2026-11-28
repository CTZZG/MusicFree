import { GlobalState } from "@/utils/stateMapper";
import { useCallback } from "react";
import type { IDialogKey, IDialogType } from "./components";

interface IDialogInfo {
    id: number;
    name: IDialogKey | null;
    payload: any;
}

export const dialogInfoStore = new GlobalState<IDialogInfo>({
    id: 0,
    name: null,
    payload: null,
});

let nextDialogId = 0;
let supersedingProtectedId: number | null = null;

export function showDialog<T extends keyof IDialogType>(
    name: T,
    payload?: Parameters<IDialogType[T]>[0],
) {
    const previousDialog = dialogInfoStore.getValue();
    const nextId = ++nextDialogId;
    dialogInfoStore.setValue({
        id: nextId,
        name,
        payload,
    });
    if (previousDialog.name !== null) {
        const settleSuperseded =
            previousDialog.payload?.onDismiss ??
            previousDialog.payload?.onCancel;
        if (typeof settleSuperseded === "function") {
            supersedingProtectedId = nextId;
            try {
                settleSuperseded();
            } catch {
                // Ignore callback failure so superseding dialog stays mounted.
            } finally {
                supersedingProtectedId = null;
            }
        }
    }
}

export function hideDialog(expectedDialogId?: number) {
    const currentDialog = dialogInfoStore.getValue();
    if (
        expectedDialogId !== undefined &&
        currentDialog.id !== expectedDialogId
    ) {
        return false;
    }
    if (
        expectedDialogId === undefined &&
        supersedingProtectedId !== null &&
        currentDialog.id === supersedingProtectedId
    ) {
        return false;
    }
    dialogInfoStore.setValue({
        id: currentDialog.id,
        name: null,
        payload: null,
    });
    return true;
}

export default function useDialog() {
    const show = useCallback(
        <T extends keyof IDialogType>(
            name: T,
            payload?: Parameters<IDialogType[T]>[0],
        ) => {
            showDialog(name, payload);
        },
        [],
    );

    const hide = useCallback(() => {
        hideDialog();
    }, []);

    return { showDialog: show, hideDialog: hide };
}

export function getCurrentDialog() {
    return dialogInfoStore.getValue();
}
