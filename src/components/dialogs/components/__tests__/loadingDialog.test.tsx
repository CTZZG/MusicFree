import React from "react";
import {
    act,
    create,
    ReactTestRenderer,
} from "react-test-renderer";

const mockHideDialog = jest.fn();

jest.mock("../../useDialog", () => ({
    getCurrentDialog: () => ({ id: 7 }),
    hideDialog: (...args: unknown[]) => mockHideDialog(...args),
}));

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock("@/components/base/loading", () => {
    const { View: MockView } = require("react-native");
    return MockView;
});

jest.mock("../base", () => {
    const {
        Pressable: MockPressable,
        View: MockView,
    } = require("react-native");
    const MockDialog = ({ children }: { children: React.ReactNode }) => (
        <MockView>{children}</MockView>
    );
    MockDialog.Title = ({ children }: { children: React.ReactNode }) => (
        <MockView>{children}</MockView>
    );
    MockDialog.Content = ({ children }: { children: React.ReactNode }) => (
        <MockView>{children}</MockView>
    );
    MockDialog.Actions = ({ actions = [] }: { actions: any[] }) => (
        <MockView>
            {actions.map(action => (
                <MockPressable
                    key={action.title}
                    testID={`action:${action.title}`}
                    onPress={action.onPress}
                />
            ))}
        </MockView>
    );
    return {
        __esModule: true,
        default: MockDialog,
    };
});

import LoadingDialog from "../loadingDialog";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("LoadingDialog", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("does not publish a result after unmount", async () => {
        const operation = deferred<string>();
        const onResolve = jest.fn();
        act(() => {
            renderer = create(
                <LoadingDialog
                    title="loading"
                    promise={operation.promise}
                    onResolve={onResolve}
                />,
            );
        });
        act(() => {
            renderer!.unmount();
        });

        await act(async () => {
            operation.resolve("late");
            await Promise.resolve();
        });
        expect(onResolve).not.toHaveBeenCalled();
        expect(mockHideDialog).not.toHaveBeenCalled();
    });

    it("aborts a task and ignores its late result after cancel", async () => {
        const operation = deferred<string>();
        const onResolve = jest.fn();
        const onCancel = jest.fn((hide: () => void) => hide());
        let taskSignal: AbortSignal | undefined;
        act(() => {
            renderer = create(
                <LoadingDialog
                    title="loading"
                    task={signal => {
                        taskSignal = signal;
                        return operation.promise;
                    }}
                    onResolve={onResolve}
                    onCancel={onCancel}
                />,
            );
        });

        act(() => {
            renderer!.root
                .findByProps({ testID: "action:common.cancel" })
                .props.onPress();
        });
        expect(taskSignal?.aborted).toBe(true);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(mockHideDialog).toHaveBeenCalledWith(7);

        await act(async () => {
            operation.resolve("late");
            await Promise.resolve();
        });
        expect(onResolve).not.toHaveBeenCalled();
    });

    it("does not render a cancel action without a cancel handler", () => {
        act(() => {
            renderer = create(
                <LoadingDialog
                    title="loading"
                    promise={new Promise(() => {})}
                />,
            );
        });

        expect(
            renderer!.root.findAllByProps({
                testID: "action:common.cancel",
            }),
        ).toHaveLength(0);
        expect(renderer!.toJSON()).not.toBeNull();
    });
});
