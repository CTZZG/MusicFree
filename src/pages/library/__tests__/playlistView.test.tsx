import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockNavigate = jest.fn();
const mockShowDialog = jest.fn();
const mockRemoveSheet = jest.fn();
const mockShowPanel = jest.fn();
const mockHideDialog = jest.fn();
const mockWarn = jest.fn();
const mockSheets = [
    { id: "ordinary", title: "通勤歌单", worksNum: 12 },
    { id: "favorite", title: "default", worksNum: 3 },
];

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
        default: {
            setConfig: (key: string, value: unknown) => store.set(key, JSON.stringify(value)),
            getConfig: (key: string) => store.getString(key) === undefined ? undefined : JSON.parse(store.getString(key)!),
        },
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
    default: {
        defaultSheet: { id: "favorite" },
        removeSheet: (id: string) => mockRemoveSheet(id),
        getSheets: () => mockSheets,
    },
    useSheetsBase: () => mockSheets,
    useStarredSheets: () => [],
}));
jest.mock("@/core/downloader", () => ({ useDownloadQueue: () => [] }));
jest.mock("@/components/dialogs/useDialog", () => ({
    showDialog: (...args: unknown[]) => mockShowDialog(...args),
    hideDialog: () => mockHideDialog(),
}));
jest.mock("@/components/panels/usePanel", () => ({ showPanel: (...args: unknown[]) => mockShowPanel(...args) }));
jest.mock("@/utils/toast", () => ({ __esModule: true, default: { success: jest.fn(), warn: (...args: unknown[]) => mockWarn(...args) } }));
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
    const playlistLabels = (mode = "grid") => [...new Set(container(mode).findAll(node => typeof node.props.onLongPress === "function").map(node => node.props.accessibilityLabel))];

    beforeEach(() => {
        store.clearAll();
        mockSheets.splice(2);
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
        expect(playlistLabels(mode)).toEqual(["我喜欢，3首", "通勤歌单，12首"]);
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

    it("filters playlist names immediately, clears the filter, and leaves organization unchanged", () => {
        mount();
        const input = renderer!.root.findAll(node => node.props.testID === "library-playlist-search")[0];
        act(() => input.props.onChangeText(" 通勤 "));
        expect(playlistLabels()).toEqual(["通勤歌单，12首"]);
        act(() => input.props.onChangeText("不存在"));
        expect(playlistLabels()).toEqual([]);
        expect(renderer!.root.findAll(node => node.props.children === "没有匹配的歌单").length).toBeGreaterThan(0);
        act(() => button("清空").props.onPress());
        expect(playlistLabels()).toEqual(["我喜欢，3首", "通勤歌单，12首"]);
        expect(store.getString("library.playlistOrganization")).toBeUndefined();
    });

    it("pins through a separate management button, persists after remount, and keeps favorites first", () => {
        mockSheets.push({ id: "night", title: "Late Night Music", worksNum: 8 });
        mount();
        act(() => button("管理歌单：Late Night Music").props.onPress());
        expect(mockNavigate).not.toHaveBeenCalled();
        const [, menu] = mockShowPanel.mock.calls[0];
        act(() => menu.onPress(menu.candidates.find((item: any) => item.value === "pin")));
        expect(playlistLabels()).toEqual(["我喜欢，3首", "Late Night Music，8首", "通勤歌单，12首"]);
        unmount();
        mount();
        expect(playlistLabels()).toEqual(["我喜欢，3首", "Late Night Music，8首", "通勤歌单，12首"]);
        expect(renderer!.root.findAll(node => node.props.accessibilityLabel === "管理歌单：我喜欢")).toHaveLength(0);
    });

    it("assigns groups, filters them, and falls back to all playlists when the selected group is removed", () => {
        store.set("library.playlistOrganization", JSON.stringify({ pinnedIds: [], groupBySheetId: { ordinary: "通勤" } }));
        mount();
        act(() => button("通勤").props.onPress());
        expect(playlistLabels()).toEqual(["通勤歌单，12首"]);
        act(() => button("管理歌单：通勤歌单").props.onPress());
        const [, menu] = mockShowPanel.mock.calls[0];
        act(() => menu.onPress(menu.candidates.find((item: any) => item.value === "group")));
        const [, groups] = mockShowPanel.mock.calls[1];
        act(() => groups.onPress({ value: "" }));
        expect(playlistLabels()).toEqual(["我喜欢，3首", "通勤歌单，12首"]);
        expect(JSON.parse(store.getString("library.playlistOrganization"))).toEqual({ pinnedIds: [], groupBySheetId: {} });
    });

    it("creates a group in a dialog, validates a blank name, and reads latest stored preferences", () => {
        mount();
        act(() => button("管理歌单：通勤歌单").props.onPress());
        const [, menu] = mockShowPanel.mock.calls[0];
        act(() => menu.onPress({ value: "group" }));
        const [, groups] = mockShowPanel.mock.calls[1];
        act(() => groups.onPress({ value: null }));
        const [, dialog] = mockShowDialog.mock.calls[0];
        // 和其他对话框一样只有「取消」「确定」两个按钮，「确定」在右边
        expect(dialog.extraActions).toBeUndefined();
        expect(dialog.okText).toBeUndefined();
        expect(dialog.cancelText).toBeUndefined();
        let result: unknown;
        act(() => {
            result = dialog.onOk();
        });
        expect(mockWarn).toHaveBeenCalledWith("请输入分组名称");
        // 返回 false：SimpleDialog 不关对话框，用户可以接着输入
        expect(result).toBe(false);
        act(() => store.set("library.playlistOrganization", JSON.stringify({ pinnedIds: ["ordinary"], groupBySheetId: {} })));
        let editor: ReactTestRenderer;
        act(() => {
            editor = create(dialog.content);
        });
        const input = editor!.root.findAll(node => node.props.testID === "library-group-name")[0];
        act(() => input.props.onChangeText("  工作  "));
        expect(input.props.value).toBe("  工作  ");
        act(() => {
            result = dialog.onOk();
        });
        expect(result).not.toBe(false);
        expect(JSON.parse(store.getString("library.playlistOrganization"))).toEqual({ pinnedIds: ["ordinary"], groupBySheetId: { ordinary: "工作" } });
        act(() => editor.unmount());
    });

    it("cleans stale preferences after successful deletion and keeps them if deletion fails", async () => {
        store.set("library.playlistOrganization", JSON.stringify({ pinnedIds: ["ordinary", "missing"], groupBySheetId: { ordinary: "通勤", missing: "Old" } }));
        mount();
        act(() => button("通勤歌单，12首").props.onLongPress());
        const [, dialog] = mockShowDialog.mock.calls[0];
        mockRemoveSheet.mockRejectedValueOnce(new Error("disk full"));
        await act(async () => {
            await expect(dialog.onOk()).rejects.toThrow("disk full");
        });
        expect(JSON.parse(store.getString("library.playlistOrganization")).pinnedIds).toContain("ordinary");
        await act(async () => dialog.onOk());
        expect(JSON.parse(store.getString("library.playlistOrganization"))).toEqual({ pinnedIds: [], groupBySheetId: {} });
    });
});
