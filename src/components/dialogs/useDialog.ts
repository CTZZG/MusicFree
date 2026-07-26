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

export function showDialog<T extends keyof IDialogType>(
    name: T,
    payload?: Parameters<IDialogType[T]>[0],
) {
    dialogInfoStore.setValue({
        id: ++nextDialogId,
        name,
        payload,
    });
}

export function hideDialog(expectedDialogId?: number) {
    const currentDialog = dialogInfoStore.getValue();
    if (
        expectedDialogId !== undefined &&
        currentDialog.id !== expectedDialogId
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
