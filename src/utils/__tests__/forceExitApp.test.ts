// 复核 4b4b833b（P2）：退出时收集播放进度和落盘是并行的。播放器要等原生返回
// 进度才写断点，落盘先完成了，新断点留在内存里，下次打开回到旧位置。

const mockDisk = new Map<string, string>();
const mockExit = jest.fn();
const mockPlayer: { prepareForAppExit: jest.Mock } = { prepareForAppExit: jest.fn() };

jest.mock("@/utils/keyValueStore/filePersistence", () => ({
    KV_STORE_DIR: "/kv",
    createFilePersistence: () => ({
        read: async (id: string) => mockDisk.get(id) ?? null,
        write: async (id: string, contents: string) => {
            mockDisk.set(id, contents);
        },
        remove: async (id: string) => {
            mockDisk.delete(id);
        },
    }),
}));
jest.mock("@/utils/logTransport", () => ({ emitErrorLog: jest.fn() }));
jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: { mmkvPath: "/mmkv", mmkvCachePath: "/mmkv-cache" },
}));
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: { prepareForAppExit: () => mockPlayer.prepareForAppExit() },
}));
jest.mock("@/native/utils", () => ({ __esModule: true, default: { exitApp: () => mockExit() } }));

import { getKeyValueStore } from "@/utils/keyValueStore";
import { decodeSnapshot, encodeSnapshot } from "@/utils/keyValueStore/snapshotCodec";
import forceExitApp from "../forceExitApp";

function progressOnDisk() {
    const raw = mockDisk.get("App.PersistStatus");
    return raw ? decodeSnapshot(raw).entries.progress : undefined;
}

describe("forceExitApp", () => {
    it("saves the final playback position before asking the system to exit", async () => {
        mockDisk.set("App.PersistStatus", encodeSnapshot({ progress: { t: "n", v: 10 } }));
        const status = getKeyValueStore("App.PersistStatus");
        await status.hydrate();
        // 原生过一会儿才返回最终进度，播放器随后写进 PersistStatus
        mockPlayer.prepareForAppExit.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            status.set("progress", 80);
        });
        let progressAtExit: unknown;
        mockExit.mockImplementation(() => {
            progressAtExit ??= progressOnDisk();
        });

        forceExitApp();
        for (let i = 0; i < 100 && !mockExit.mock.calls.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        expect(mockExit).toHaveBeenCalled();
        expect(mockPlayer.prepareForAppExit).toHaveBeenCalled();
        expect(progressAtExit).toEqual({ t: "n", v: 80 });
    });
});
