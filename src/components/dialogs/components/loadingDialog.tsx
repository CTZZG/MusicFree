import React, { ReactNode, useCallback, useEffect, useRef } from "react";
import Loading from "@/components/base/loading";
import rpx from "@/utils/rpx";
import { StyleSheet } from "react-native";
import { getCurrentDialog, hideDialog } from "../useDialog";
import Dialog from "./base";
import { useI18N } from "@/core/i18n";

interface ILoadingDialogProps<T extends any = any> {
    promise?: Promise<T>;
    task?: (signal: AbortSignal) => Promise<T>;
    title: string;
    loadingText?: ReactNode;
    onResolve?: (data: T, hideDialog: () => void) => void;
    onReject?: (reason: any, hideDialog: () => void) => void;
    onCancel?: (hideDialog: () => void) => void;
}
export default function LoadingDialog(props: ILoadingDialogProps) {
    const { title, loadingText, onResolve, onReject, promise, task, onCancel } =
        props;
    const { t } = useI18N();
    const dialogIdRef = useRef(getCurrentDialog().id);
    const settledRef = useRef(false);
    const activeRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    const hideCurrentDialog = useCallback(() => {
        hideDialog(dialogIdRef.current);
    }, []);

    useEffect(() => {
        activeRef.current = true;
        settledRef.current = false;
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        let operation: Promise<any> | undefined;
        try {
            operation = promise ?? task?.(abortController.signal);
        } catch (error) {
            operation = Promise.reject(error);
        }

        operation
            ?.then(data => {
                if (!activeRef.current || settledRef.current) {
                    return;
                }
                settledRef.current = true;
                if (onResolve) {
                    onResolve(data, hideCurrentDialog);
                } else {
                    hideCurrentDialog();
                }
            })
            .catch(error => {
                if (!activeRef.current || settledRef.current) {
                    return;
                }
                settledRef.current = true;
                if (onReject) {
                    onReject(error, hideCurrentDialog);
                } else {
                    hideCurrentDialog();
                }
            });

        return () => {
            activeRef.current = false;
            abortController.abort();
            abortControllerRef.current = null;
        };
    }, [
        hideCurrentDialog,
        onReject,
        onResolve,
        promise,
        task,
    ]);

    const cancel = useCallback(() => {
        if (settledRef.current || !onCancel) {
            return;
        }
        settledRef.current = true;
        abortControllerRef.current?.abort();
        onCancel(hideCurrentDialog);
    }, [hideCurrentDialog, onCancel]);

    return (
        <Dialog onDismiss={onCancel ? cancel : undefined}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content style={style.content}>
                <Loading text={loadingText ?? t("common.loading")} />
            </Dialog.Content>
            <Dialog.Actions
                actions={onCancel
                    ? [{
                        title: t("common.cancel"),
                        onPress: cancel,
                    }]
                    : []}
            />
        </Dialog>
    );
}

const style = StyleSheet.create({
    content: {
        height: rpx(280),
    },
});
