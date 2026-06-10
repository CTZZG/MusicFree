import React from "react";
import { hideDialog } from "../useDialog";
import Dialog from "./base";
import { useI18N } from "@/core/i18n";

interface ISimpleDialogProps {
    title: string;
    content: string | JSX.Element;
    okText?: string;
    cancelText?: string;
    extraActions?: Array<{
        title: string;
        type?: "normal" | "primary";
        show?: boolean;
        closeOnPress?: boolean;
        onPress?: () => void;
    }>;
    onOk?: () => void;
    onCancel?: () => void;
    onDismiss?: () => void;
}
export default function SimpleDialog(props: ISimpleDialogProps) {
    const {
        title,
        content,
        onOk,
        onCancel,
        onDismiss,
        okText,
        cancelText,
        extraActions = [],
    } = props;

    const { t } = useI18N();
    const mappedExtraActions = extraActions.map(action => ({
        ...action,
        onPress() {
            action.onPress?.();
            if (action.closeOnPress) {
                hideDialog();
            }
        },
    }));

    const actions = onOk
        ? [
            {
                title: cancelText ?? t("common.cancel"),
                type: "normal",
                onPress() {
                    onCancel?.();
                    hideDialog();
                },
            },
            ...mappedExtraActions,
            {
                title: okText ?? t("common.confirm"),
                type: "primary",
                onPress() {
                    onOk?.();
                    hideDialog();
                },
            },
        ]
        : ([
            ...mappedExtraActions,
            {
                title: okText ?? t("dialog.errorLogKnow"),
                type: "primary",
                onPress() {
                    hideDialog();
                },
            },
        ] as any);

    return (
        <Dialog onDismiss={() => {
            onDismiss?.();
            hideDialog();
        }}>
            <Dialog.Title withDivider>{title}</Dialog.Title>
            <Dialog.Content needScroll>{content}</Dialog.Content>
            <Dialog.Actions actions={actions} />
        </Dialog>
    );
}
