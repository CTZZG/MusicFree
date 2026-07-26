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
});
