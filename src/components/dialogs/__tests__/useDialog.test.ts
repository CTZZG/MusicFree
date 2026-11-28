import {
    getCurrentDialog,
    hideDialog,
    showDialog,
} from "../useDialog";

describe("dialog instance lifecycle", () => {
    afterEach(() => {
        hideDialog();
    });

    it("does not let an old dialog hide a newer dialog", () => {
        showDialog("LoadingDialog", {
            title: "old",
            promise: Promise.resolve(),
        });
        const oldDialogId = getCurrentDialog().id;

        showDialog("SimpleDialog", {
            title: "new",
            content: "content",
        });
        const newDialog = getCurrentDialog();

        expect(hideDialog(oldDialogId)).toBe(false);
        expect(getCurrentDialog()).toEqual(newDialog);
        expect(hideDialog(newDialog.id)).toBe(true);
        expect(getCurrentDialog().name).toBeNull();
    });

    it("settles superseded dialog onDismiss once without closing the replacement dialog", () => {
        const onDismissFirst = jest.fn(() => {
            hideDialog();
        });
        showDialog("SimpleDialog", {
            title: "first",
            content: "awaiting confirmation",
            onDismiss: onDismissFirst,
        });

        showDialog("SimpleDialog", {
            title: "second",
            content: "replacement",
        });

        expect(onDismissFirst).toHaveBeenCalledTimes(1);
        expect(getCurrentDialog().name).toBe("SimpleDialog");
        expect(getCurrentDialog().payload?.title).toBe("second");

        hideDialog();
        showDialog("SimpleDialog", {
            title: "third",
            content: "after normal hide",
        });
        expect(onDismissFirst).toHaveBeenCalledTimes(1);
    });

    it("keeps follow-up dialog mounted when superseded onDismiss re-enters showDialog and calls hideDialog", () => {
        const onDismissSecond = jest.fn(() => {
            hideDialog();
        });
        const onDismissFirst = jest.fn(() => {
            showDialog("SimpleDialog", {
                title: "follow-up",
                content: "opened during dismiss",
            });
            hideDialog();
        });

        showDialog("SimpleDialog", {
            title: "first",
            content: "initial",
            onDismiss: onDismissFirst,
        });
        showDialog("SimpleDialog", {
            title: "second",
            content: "superseding",
            onDismiss: onDismissSecond,
        });

        expect(onDismissFirst).toHaveBeenCalledTimes(1);
        expect(onDismissSecond).toHaveBeenCalledTimes(1);
        expect(getCurrentDialog().name).toBe("SimpleDialog");
        expect(getCurrentDialog().payload?.title).toBe("follow-up");
    });
});
