/**
 * React Navigation 7 的 navigate 遇到同名页面会把当前页面的参数原地换掉：基本设置里
 * 打开缓存管理，基本设置这一页就被换掉了，返回键直接回到设置标签。这组测试锁住
 * useNavigate 什么时候新开一页、什么时候照常 navigate。
 */
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockRootState:
    | { index: number; routes: Array<{ name: string }> }
    | undefined;

jest.mock("@react-navigation/native", () => ({
    // 工厂在 import 时就执行，那时 mock 变量还没赋值，只能在闭包里引用
    createNavigationContainerRef: () => ({
        isReady: () => mockRootState !== undefined,
        getRootState: () => mockRootState,
        dispatch: jest.fn(),
    }),
    StackActions: {
        push: (name: string, params?: object) => ({
            type: "PUSH",
            payload: { name, params },
        }),
        popTo: (name: string, params?: object) => ({
            type: "POP_TO",
            payload: { name, params },
        }),
    },
    useNavigation: () => ({
        navigate: (...args: unknown[]) => mockNavigate(...args),
        dispatch: (action: unknown) => mockDispatch(action),
    }),
    useRoute: jest.fn(),
}));

import { ROUTE_PATH, useNavigate } from "..";

describe("useNavigate", () => {
    let renderer: ReactTestRenderer | undefined;

    function renderNavigate() {
        let navigate!: ReturnType<typeof useNavigate>;
        function Probe() {
            navigate = useNavigate();
            return null;
        }
        act(() => {
            renderer = create(<Probe />);
        });
        return navigate;
    }

    beforeEach(() => {
        mockNavigate.mockClear();
        mockDispatch.mockClear();
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("opens a settings sub-page on top of basic settings", () => {
        mockRootState = {
            index: 1,
            routes: [{ name: ROUTE_PATH.HOME }, { name: ROUTE_PATH.SETTING }],
        };

        renderNavigate()(ROUTE_PATH.SETTING, { type: "cacheManagement" });

        expect(mockDispatch).toHaveBeenCalledWith({
            type: "PUSH",
            payload: {
                name: ROUTE_PATH.SETTING,
                params: { type: "cacheManagement" },
            },
        });
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("opens another artist on top of the current artist page", () => {
        mockRootState = {
            index: 1,
            routes: [
                { name: ROUTE_PATH.HOME },
                { name: ROUTE_PATH.ARTIST_DETAIL },
            ],
        };
        const params = {
            artistItem: { id: "2", platform: "p", name: "b" } as any,
            pluginHash: "hash",
        };

        renderNavigate()(ROUTE_PATH.ARTIST_DETAIL, params);

        expect(mockDispatch).toHaveBeenCalledWith({
            type: "PUSH",
            payload: { name: ROUTE_PATH.ARTIST_DETAIL, params },
        });
    });

    it("keeps navigate when opening a different page", () => {
        mockRootState = { index: 0, routes: [{ name: ROUTE_PATH.HOME }] };

        renderNavigate()(ROUTE_PATH.SETTING, { type: "basic" });

        expect(mockNavigate).toHaveBeenCalledWith(ROUTE_PATH.SETTING, {
            type: "basic",
        });
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("does not stack a second copy of a page opened without params", () => {
        mockRootState = {
            index: 1,
            routes: [
                { name: ROUTE_PATH.HOME },
                { name: ROUTE_PATH.MUSIC_DETAIL },
            ],
        };

        renderNavigate()(ROUTE_PATH.MUSIC_DETAIL);

        expect(mockNavigate).toHaveBeenCalledWith(
            ROUTE_PATH.MUSIC_DETAIL,
            undefined,
        );
        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
