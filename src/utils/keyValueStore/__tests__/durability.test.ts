/** Real store, codec and file backend; only the RNFS I/O boundary is injected. */
jest.mock("react-native-fs", () => {
    const files = new Map<string, string>();
    const api = {
        DocumentDirectoryPath: "/private",
        exists: jest.fn(async (path: string) => path === "/private/kvstore" || files.has(path)),
        mkdir: jest.fn(async () => undefined),
        readFile: jest.fn(async (path: string) => {
            if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
            return files.get(path)!;
        }),
        writeFile: jest.fn(async (path: string, raw: string) => {
            files.set(path, raw);
        }),
        moveFile: jest.fn(async (from: string, to: string) => {
            if (!files.has(from)) throw new Error("missing source");
            files.set(to, files.get(from)!);
            files.delete(from);
        }),
        unlink: jest.fn(async (path: string) => {
            files.delete(path);
        }),
    };
    return { __esModule: true, default: api, files };
});

import RNFS from "react-native-fs";
import { createFilePersistence } from "../filePersistence";
import KeyValueStore from "../store";
import { encodeSnapshot } from "../snapshotCodec";

const files: Map<string, string> = jest.requireMock("react-native-fs").files;
const io = jest.mocked(RNFS);
const primary = "/private/kvstore/s.json";
const raw = (v: string) => encodeSnapshot({ data: { t: "s", v } });
const options = { setTimer: () => 0, clearTimer: () => undefined };
const store = () => new KeyValueStore("s", createFilePersistence(), options);

const defaultMove = io.moveFile.getMockImplementation()!;

beforeEach(() => {
    files.clear();
    jest.clearAllMocks();
    io.moveFile.mockReset().mockImplementation(defaultMove);
});

it("retains a valid file on read failure, then replays pending updates on retry", async () => {
    files.set(primary, encodeSnapshot({ saved: { t: "s", v: "keep" }, data: { t: "s", v: "old" } }));
    io.readFile.mockRejectedValueOnce(new Error("EIO"));
    const target = store();
    await expect(target.hydrate()).rejects.toMatchObject({ name: "StoreReadError" });
    expect(target.isHydrated).toBe(false);
    expect(io.writeFile).not.toHaveBeenCalled();
    target.set("data", "new");
    await expect(target.flush()).resolves.toBe(true);
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("saved")).toBe("keep");
    expect(restarted.getString("data")).toBe("new");
});

it("keeps persistent read errors out of the write and empty-data paths", async () => {
    files.set(primary, raw("last-good"));
    io.readFile.mockRejectedValueOnce(new Error("EIO")).mockRejectedValueOnce(new Error("EIO"));
    const target = store();
    await expect(target.hydrate()).rejects.toThrow();
    target.set("new", "value");
    await expect(target.flush()).resolves.toBe(false);
    expect(files.get(primary)).toBe(raw("last-good"));
    expect(io.writeFile).not.toHaveBeenCalled();
});

it.each(["", "{invalid", "{\"version\":99,\"entries\":{}}"]) (
    "refuses to overwrite malformed or future-version input: %s", async invalid => {
        files.set(primary, invalid);
        const target = store();
        await expect(target.hydrate()).rejects.toThrow();
        target.set("new", "value");
        await expect(target.flush()).resolves.toBe(false);
        expect(files.get(primary)).toBe(invalid);
    },
);

it("uses the previous snapshot without rotating corrupt data over it", async () => {
    files.set(primary, "{truncated");
    files.set(`${primary}.bak`, raw("last-good"));
    const target = store();
    await target.hydrate();
    expect(target.getString("data")).toBe("last-good");
    target.set("data", "updated");
    await expect(target.flush()).resolves.toBe(true);
    expect(files.get(`${primary}.corrupt`)).toBe("{truncated");
    expect(files.get(`${primary}.bak`)).toBe(raw("last-good"));
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("data")).toBe("updated");
});

it("does not downgrade a future schema even when an older backup exists", async () => {
    const future = "{\"version\":99,\"entries\":{}}";
    files.set(primary, future);
    files.set(`${primary}.bak`, raw("older"));
    const target = store();
    await expect(target.hydrate()).rejects.toMatchObject({ reason: "unsupported-version:99" });
    target.set("data", "new");
    await expect(target.flush()).resolves.toBe(false);
    expect(files.get(primary)).toBe(future);
});

it.each([1, 2])("survives process exit after move %i fails", async failingMove => {
    files.set(primary, raw("last-good"));
    let move = 0;
    io.moveFile.mockImplementationOnce(async (from, to) => {
        move++;
        if (move === failingMove) throw new Error("rename failed");
        files.set(to, files.get(from)!);
        files.delete(from);
    });
    if (failingMove === 2) io.moveFile.mockRejectedValueOnce(new Error("rename failed"));
    const target = store();
    await target.hydrate();
    target.set("data", "candidate");
    await expect(target.flush()).resolves.toBe(false);
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("data")).toBe("last-good");
});

it("recovers after interruption with only the first complete temp remaining", async () => {
    files.set(`${primary}.tmp`, raw("candidate"));
    const target = store();
    await target.hydrate();
    target.set("data", "newer");
    io.writeFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(target.flush()).resolves.toBe(false);
    expect(files.get(`${primary}.bak`)).toBe(raw("candidate"));
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("data")).toBe("candidate");
});

it("retains the backup when RNFS leaves a truncated primary after copy failure", async () => {
    files.set(primary, raw("last-good"));
    const backend = createFilePersistence();
    const target = new KeyValueStore("s", backend, options);
    await target.hydrate();
    io.moveFile.mockImplementationOnce(async (from, to) => {
        files.set(to, files.get(from)!); files.delete(from);
    }).mockImplementationOnce(async (_from, to) => {
        files.set(to, "{partial"); throw new Error("copy failed");
    });
    target.set("data", "candidate");
    await expect(target.flush()).resolves.toBe(false);
    await expect(target.flush()).resolves.toBe(true);
    expect(files.get(`${primary}.bak`)).toBe(raw("last-good"));
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("data")).toBe("candidate");
});

it("explicit deletion removes recovery files so deleted data cannot return", async () => {
    for (const suffix of ["", ".bak", ".tmp", ".corrupt"]) files.set(`${primary}${suffix}`, raw("old"));
    const backend = createFilePersistence();
    await backend.remove("s");
    expect(files.size).toBe(0);
    expect(await backend.read("s")).toBeNull();
});


it("keeps last-good bytes when every rename fails", async () => {
    files.set(primary, raw("last-good"));
    io.moveFile.mockRejectedValueOnce(new Error("rename failed")).mockRejectedValueOnce(new Error("rename failed"));
    const target = store();
    await target.hydrate();
    target.set("data", "candidate");
    await expect(target.flush()).resolves.toBe(false);
    expect(files.get(primary)).toBe(raw("last-good"));
    const restarted = store();
    await restarted.hydrate();
    expect(restarted.getString("data")).toBe("last-good");
});
