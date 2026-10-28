jest.mock("@/constants/pathConst", () => ({ __esModule: true, default: { mmkvPath: "/legacy", mmkvCachePath: "/legacy-cache" } }));
jest.mock("@/utils/logTransport", () => ({ emitErrorLog: jest.fn() }));
jest.mock("react-native-mmkv", () => ({ createMMKV: jest.fn(() => ({ getAllKeys: () => [] })) }));
jest.mock("../filePersistence", () => ({ KV_STORE_DIR: "/kv", createFilePersistence: () => ({ read: async () => null, write: async () => undefined }) }));

import { encodeSnapshot, decodeSnapshot } from "../snapshotCodec";

beforeEach(() => {
    jest.resetModules(); jest.useFakeTimers();
});
afterEach(() => {
    jest.clearAllTimers(); jest.useRealTimers();
});

function backend() {
    const files = new Map<string, string>();
    let unreadable = true;
    return {
        files, recover: () => {
            unreadable = false;
        },
        io: {
            read: async (id: string) => {
                if (unreadable) throw new Error("EIO");
                return files.get(id) ?? null;
            },
            write: jest.fn(async (id: string, raw: string) => {
                files.set(id, raw);
            }),
            remove: jest.fn(async () => undefined),
        },
    };
}

it("blocks startup before migration when storage is unreadable, and allows a later retry", async () => {
    const data = backend();
    data.files.set("App.config", encodeSnapshot({ setting: { t: "s", v: "retained" } }));
    const registry = require("../index") as typeof import("../index");
    registry.setKeyValueStorePersistenceForTests(data.io);
    const { setupKeyValueStores } = require("../bootstrapStores") as typeof import("../bootstrapStores");
    await expect(setupKeyValueStores()).rejects.toMatchObject({ name: "StoreReadError" });
    expect(require("react-native-mmkv").createMMKV).not.toHaveBeenCalled();
    expect(data.io.write).not.toHaveBeenCalled();
    expect(registry.getKeyValueStore("App.config").isHydrated).toBe(false);
    data.recover();
    await expect(setupKeyValueStores()).resolves.toBeUndefined();
    await expect(registry.flushKeyValueStores()).resolves.toBe(true);
    expect(decodeSnapshot(data.files.get("App.config")).entries.setting).toEqual({ t: "s", v: "retained" });
});

it("does not cache a failed dynamic preparation or mark it migrated", async () => {
    const data = backend();
    data.files.set("LocalSheet.example", encodeSnapshot({ data: { t: "s", v: "saved songs" } }));
    const registry = require("../index") as typeof import("../index");
    registry.setKeyValueStorePersistenceForTests(data.io);
    const { prepareKeyValueStore } = require("@/utils/getOrCreateMMKV") as typeof import("@/utils/getOrCreateMMKV");
    await expect(prepareKeyValueStore("LocalSheet.example")).rejects.toThrow();
    expect(data.io.write).not.toHaveBeenCalled();
    data.recover();
    await expect(prepareKeyValueStore("LocalSheet.example")).resolves.toBeUndefined();
    const target = registry.getKeyValueStore("LocalSheet.example");
    await target.flush();
    expect(target.getString("data")).toBe("saved songs");
});

it("retains deletion tombstones across a failed preparation and legacy retry", async () => {
    const data = backend();
    const registry = require("../index") as typeof import("../index");
    registry.setKeyValueStorePersistenceForTests(data.io);
    const { prepareKeyValueStore } = require("@/utils/getOrCreateMMKV") as typeof import("@/utils/getOrCreateMMKV");
    const request = prepareKeyValueStore("MediaExtra.example");
    const target = registry.getKeyValueStore("MediaExtra.example");
    target.delete("deleted");
    await expect(request).rejects.toThrow();
    require("react-native-mmkv").createMMKV.mockReturnValueOnce({
        getAllKeys: () => ["deleted"], getString: () => "stale legacy value",
    });
    data.recover();
    await prepareKeyValueStore("MediaExtra.example");
    await target.flush();
    expect(target.getString("deleted")).toBeUndefined();
});
