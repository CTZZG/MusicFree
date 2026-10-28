import React from "react";
import Renderer, { act } from "react-test-renderer";

const mockGet = jest.fn();
const mockPanel = jest.fn();
const mockDialog = jest.fn();
const mockWarn = jest.fn();
const mockPreview = jest.fn((raw: unknown) => {
    // The existing backup API accepts JSON text or an already parsed object.
    // This boundary double deliberately rejects the old "[object Object]" value.
    if (typeof raw === "string") JSON.parse(raw);
    return { musicSheetCount: 1, musicCount: 0, localMusicCount: 0, starredMusicSheetCount: 0, pluginCount: 0, invalidPluginCount: 0, pluginConfigCount: 0, hasPreferences: false };
});
jest.mock("@/components/base/listItem", () => {
    const react = require("react");
    const Item = (props: any) => react.createElement("ListItem", props, props.children);
    Item.Content = "ListItemContent"; Item.ListItemText = "ListItemText";
    return { __esModule: true, default: Item, ListItemHeader: "ListItemHeader" };
});
jest.mock("@/components/base/themeText", () => "ThemeText");
jest.mock("@/components/base/switch", () => "ThemeSwitch");
jest.mock("@/core/backup", () => ({ __esModule: true, default: { preview: (raw: unknown) => mockPreview(raw) } }));
jest.mock("@/core/router", () => ({ useNavigate: () => jest.fn(), ROUTE_PATH: {} }));
jest.mock("@/utils/toast", () => ({ __esModule: true, default: { warn: (...args: unknown[]) => mockWarn(...args), success: jest.fn() } }));
jest.mock("@/components/dialogs/useDialog", () => ({ showDialog: (...args: unknown[]) => mockDialog(...args) }));
jest.mock("@/components/panels/usePanel", () => ({ showPanel: (...args: unknown[]) => mockPanel(...args) }));
jest.mock("react-native-reanimated", () => ({ Easing: { exp: jest.fn(), out: jest.fn() } }));
jest.mock("@/core/appConfig", () => ({ __esModule: true, default: {}, useAppConfig: () => undefined, getCredentialMigrationError: () => null }));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("@/core/webdavBackup", () => ({}));
jest.mock("@/utils/delay", () => ({ __esModule: true, default: async () => undefined }));
jest.mock("@/utils/fileUtils.ts", () => ({}));
jest.mock("@/utils/log.ts", () => ({ errorLog: jest.fn() }));
jest.mock("@/utils/persistStatus", () => ({ __esModule: true, default: { useValue: () => undefined } }));
jest.mock("expo-document-picker", () => ({}));
jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("react-native-fs", () => ({ DocumentDirectoryPath: "/private" }));
jest.mock("@react-native-clipboard/clipboard", () => ({ __esModule: true, default: {} }));
jest.mock("@/native/secureCredential", () => ({ __esModule: true, default: {} }));
jest.mock("@/native/storageUri", () => ({ __esModule: true, default: {} }));
jest.mock("@/utils/restrictedHttpClient", () => ({ createRestrictedHttpClient: () => ({ get: (...args: unknown[]) => mockGet(...args) }) }));
jest.mock("../webdavSettingsTransaction", () => ({}));

import BackupSetting from "../backupSetting";

let tree: Renderer.ReactTestRenderer;
beforeEach(() => {
    jest.clearAllMocks(); jest.useFakeTimers(); act(() => {
        tree = Renderer.create(<BackupSetting />);
    });
});
afterEach(() => {
    act(() => {
        tree.unmount();
    }); jest.clearAllTimers(); jest.useRealTimers();
});

async function submitRemote() {
    const item = tree.root.findAllByType("ListItem" as any).find(node =>
        node.findAllByType("ListItemContent" as any).some(child => child.props.title === "backupAndResume.resumeFromUrlDialogTitle"));
    act(() => {
 item!.props.onPress();
    });
    const panel = mockPanel.mock.calls.find(([name]) => name === "SimpleInput")![1];
    const close = jest.fn();
    await act(async () => {
        await panel.onOk("https://example.org/backup.json", close);
    });
    act(() => {
        jest.runOnlyPendingTimers();
    });
    return close;
}

it("opens preview for JSON already decoded by actual Axios", async () => {
    const axios = jest.requireActual(require("path").join(process.cwd(), "node_modules/axios/dist/node/axios.cjs"));
    const payload = { version: 3, musicSheets: [{ id: "original", title: "Backup", musicList: [] }] };
    const response = await axios.get("https://example.org/backup.json", { adapter: async (config: unknown) => ({
        data: JSON.stringify(payload), status: 200, statusText: "OK", headers: { "content-type": "application/json" }, config,
    }) });
    expect(typeof response.data).toBe("object");
    mockGet.mockResolvedValueOnce(response);
    const close = await submitRemote();
    expect(mockPreview).toHaveBeenCalledWith(payload);
    expect(mockDialog).toHaveBeenCalledWith("SimpleDialog", expect.objectContaining({ title: "backupAndResume.resumePreviewTitle" }));
    expect(close).toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
});

it("also accepts a plain JSON text response", async () => {
    const text = "{\"musicSheets\":[]}";
    mockGet.mockResolvedValueOnce({ data: text });
    await submitRemote();
    expect(mockPreview).toHaveBeenCalledWith(text);
    expect(mockDialog).toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
});

it("does not open preview or close the input on a transport failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("network failure"));
    const close = await submitRemote();
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockDialog).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalled();
});

it("leaves invalid JSON to the existing preview error handling", async () => {
    mockGet.mockResolvedValueOnce({ data: "{invalid" });
    await submitRemote();
    expect(mockDialog).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalled();
});
