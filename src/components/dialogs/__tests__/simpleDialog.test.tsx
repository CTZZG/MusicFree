import React from "react";
import { act, create } from "react-test-renderer";

const mockHideDialog = jest.fn();
let mockActions: Array<{ title: string; type?: string; onPress?: () => void }> = [];

jest.mock("../useDialog", () => ({
    hideDialog: () => mockHideDialog(),
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({
        t: (key: string) => ({ "common.cancel": "取消", "common.confirm": "确定" })[key] ?? key,
    }),
}));
jest.mock("../components/base", () => {
    const Dialog = ({ children }: any) => children;
    Dialog.Title = () => null;
    Dialog.Content = () => null;
    Dialog.Actions = ({ actions }: any) => {
        mockActions = actions;
        return null;
    };
    return { __esModule: true, default: Dialog };
});

import SimpleDialog from "../components/simpleDialog";

function render(onOk: () => unknown) {
    act(() => {
        create(<SimpleDialog title="标题" content="内容" onOk={onOk as any} />);
    });
}

describe("SimpleDialog", () => {
    beforeEach(() => {
        mockHideDialog.mockClear();
        mockActions = [];
    });

    it("puts cancel on the left and the primary confirm on the right", () => {
        render(() => undefined);
        expect(mockActions.map(action => [action.title, action.type])).toEqual([
            ["取消", "normal"],
            ["确定", "primary"],
        ]);
    });

    it("stays open when onOk returns false, for input that needs fixing", () => {
        const onOk = jest.fn(() => false);
        render(onOk);
        act(() => mockActions[1].onPress?.());
        expect(onOk).toHaveBeenCalledTimes(1);
        expect(mockHideDialog).not.toHaveBeenCalled();
    });

    it("closes after onOk otherwise, including async handlers", () => {
        render(() => undefined);
        act(() => mockActions[1].onPress?.());
        expect(mockHideDialog).toHaveBeenCalledTimes(1);

        render(async () => undefined);
        act(() => mockActions[1].onPress?.());
        expect(mockHideDialog).toHaveBeenCalledTimes(2);
    });
});
