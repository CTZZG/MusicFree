import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockNavigate = jest.fn();
const mockShowDialog = jest.fn();
const mockRemoveSheet = jest.fn();

jest.mock("@/core/appConfig", () => {
    const useStoredJson = jest.requireActual("@/utils/keyValueStore/useStoredJson").default;
    const values = new Map<string, string>();
    const listeners = new Set<(mockKey: string) => void>();
    const store = {
        getString: (key: string) => values.get(key),
        set: (key: string, value: string) => {
            values.set(key, value);
            listeners.forEach(listener => listener(key));
        },
        clearAll: () => values.clear(),
        addOnValueChangedListener: (listener: (mockKey: string) => void) => {
            listeners.add(listener);
            return { remove: () => listeners.delete(listener) };
        },
    };
    return {
        __esModule: true,
        default: { setConfig: (key: string, value: unknown) => store.set(key, JSON.stringify(value)) },
        useAppConfig: (key: string) => useStoredJson(key, store),
        store,
    };
});

jest.mock("@/components/base/largeTitleScrollView", () => {
    const { View } = require("react-native");
    return {
        __esModule: true,
        default: ({ actions, children }: any) => <View>{actions}{children}</View>,
    };
});
jest.mock("@/components/base/icon", () => {
    const { View } = require("react-native");
    return { __esModule: true, default: (props: any) => <View {...props} /> };
});
jest.mock("@/components/base/fastImage", () => {
    const { View } = require("react-native");
    return { __esModule: true, default: (props: any) => <View {...props} /> };
});
jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ text: "#111111", textSecondary: "#666666", primary: "#007AFF" }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@/core/router", () => ({
    useNavigate: () => mockNavigate,
    ROUTE_PATH: { LOCAL_SHEET_DETAIL: "local-sheet-detail" },
}));
jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: { defaultSheet: { id: "favorite" }, removeSheet: (id: string) => mockRemoveSheet(id) },
    useSheetsBase: () => [
        { id: "ordinary", title: "通勤歌单", worksNum: 12 },
        { id: "favorite", title: "default", worksNum: 3 },
    ],
    useStarredSheets: () => [],
}));
jest.mock("@/core/downloader", () => ({ useDownloadQueue: () => [] }));
jest.mock("@/components/dialogs/useDialog", () => ({ showDialog: (...args: unknown[]) => mockShowDialog(...args) }));
jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));
jest.mock("@/utils/toast", () => ({ __esModule: true, default: { success: jest.fn() } }));
jest.mock("@/core/i18n", () => {
    const language = require("@/core/i18n/languages/zh-cn.json");
    return {
        useI18N: () => ({
            t: (key: string, args?: Record<string, unknown>) => language[key].replace(/{(\w+)}/g, (_: string, name: string) => String(args?.[name] ?? "")),
        }),
    };
});

import Library from "..";

const store = jest.requireMock("@/core/appConfig").store;

describe("library playlist views", () => {
    let renderer: ReactTestRenderer | undefined;
    const mount = () => act(() => {
        renderer = create(<Library />);
    });
    const unmount = () => act(() => renderer?.unmount());
    const button = (label: string) => renderer!.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === "function")[0];
    const container = (mode: string) => renderer!.root.findAll(node => node.props.testID === `library-playlist-${mode}`)[0];

    beforeEach(() => {
        store.clearAll();
        jest.clearAllMocks();
    });
    afterEach(() => {
        unmount();
        renderer = undefined;
    });

    it("switches immediately and restores the saved choice after remount", () => {
        mount();
        expect(container("grid")).toBeDefined();
        act(() => button("切换到歌单列表").props.onPress());
        expect(container("list")).toBeDefined();
        expect(store.getString("library.playlistView")).toBe(JSON.stringify("list"));
        unmount();
        mount();
        expect(container("list")).toBeDefined();
        act(() => button("切换到歌单网格").props.onPress());
        expect(container("grid")).toBeDefined();
        expect(store.getString("library.playlistView")).toBe(JSON.stringify("grid"));
    });

    it.each(["grid", "list"])("keeps favorites first and opens the same playlist in %s mode", mode => {
        store.set("library.playlistView", JSON.stringify(mode));
        mount();
        const labels = container(mode).findAll(node => node.props.accessibilityRole === "button" && typeof node.props.onPress === "function").map(node => node.props.accessibilityLabel);
        expect([...new Set(labels)]).toEqual(["我喜欢，3首", "通勤歌单，12首"]);
        act(() => button("通勤歌单，12首").props.onPress());
        expect(mockNavigate).toHaveBeenCalledWith("local-sheet-detail", { id: "ordinary" });
    });

    it.each(["grid", "list"])("keeps delete confirmation and protects favorites in %s mode", async mode => {
        store.set("library.playlistView", JSON.stringify(mode));
        mount();
        act(() => button("我喜欢，3首").props.onLongPress());
        expect(mockShowDialog).not.toHaveBeenCalled();
        act(() => button("通勤歌单，12首").props.onLongPress());
        expect(mockRemoveSheet).not.toHaveBeenCalled();
        const [, dialog] = mockShowDialog.mock.calls[0];
        await act(async () => dialog.onOk());
        expect(mockRemoveSheet).toHaveBeenCalledWith("ordinary");
    });
});
