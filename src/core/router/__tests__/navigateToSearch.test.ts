/**
 * 搜索页现在是主页的一个底部标签，根栈里没有它。所有跳搜索的地方都要
 * 先回到主页、再由标签导航切到搜索；这组测试锁住发出去的导航动作。
 */
const mockDispatch = jest.fn();
let mockReady = true;

jest.mock("@react-navigation/native", () => ({
    // 工厂在 import 时就执行，那时 mock 变量还没赋值，只能在闭包里引用
    createNavigationContainerRef: () => ({
        isReady: () => mockReady,
        dispatch: (action: unknown) => mockDispatch(action),
    }),
    StackActions: {
        popTo: (name: string, params?: object) => ({
            type: "POP_TO",
            payload: { name, params },
        }),
    },
    useNavigation: jest.fn(),
    useRoute: jest.fn(),
}));

import { HOME_TAB, navigateToHomeTab, navigateToSearch } from "..";

describe("navigateToSearch", () => {
    beforeEach(() => {
        mockDispatch.mockClear();
        mockReady = true;
    });

    it("pops back to the home tabs and switches to the search tab", () => {
        navigateToSearch({
            initialQuery: "周杰伦",
            initialSearchType: "artist",
            initialSearchToken: 7,
        });

        expect(mockDispatch).toHaveBeenCalledWith({
            type: "POP_TO",
            payload: {
                name: "home",
                params: {
                    screen: HOME_TAB.SEARCH,
                    params: {
                        initialQuery: "周杰伦",
                        initialSearchType: "artist",
                        initialSearchToken: 7,
                    },
                },
            },
        });
    });

    it("stamps a fresh token so repeating the same query searches again", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1234);
        navigateToSearch({ initialQuery: "晴天" });
        now.mockRestore();

        const action = mockDispatch.mock.calls[0][0];
        expect(action.payload.params.params).toEqual({
            initialQuery: "晴天",
            initialSearchToken: 1234,
        });
    });

    it("opens the search tab without params when there is no query", () => {
        navigateToSearch();

        expect(mockDispatch).toHaveBeenCalledWith({
            type: "POP_TO",
            payload: {
                name: "home",
                params: { screen: HOME_TAB.SEARCH, params: undefined },
            },
        });
    });

    it("does nothing before the navigation container is ready", () => {
        mockReady = false;
        navigateToSearch({ initialQuery: "x" });
        navigateToHomeTab(HOME_TAB.LIBRARY);

        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
