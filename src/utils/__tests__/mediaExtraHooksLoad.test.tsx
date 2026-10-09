/**
 * 复核 1ec0114c（P2，原有缺口）：附加信息的 store 按平台异步载入（读盘 + 迁移）。
 * 载入完成只通知了全局订阅者，单曲的 useMediaExtra / useMediaExtraProperty
 * 一直停在载入前读到的空值：下载列表、歌曲行看不到已经保存的元数据、歌词
 * 写入结果，直到重新挂载或这首歌又被改一次。
 *
 * 真实的 React、hook、键值存储和迁移；读盘由测试手动放行。
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native-mmkv", () => ({
    createMMKV: () => ({
        getAllKeys: () => [],
        getString: () => undefined,
        getNumber: () => undefined,
        getBoolean: () => undefined,
    }),
}));
jest.mock("@/utils/keyValueStore/filePersistence", () => ({
    KV_STORE_DIR: "/kv",
    createFilePersistence: () => ({
        read: async () => null,
        write: async () => undefined,
        remove: async () => undefined,
    }),
}));
jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: { mmkvPath: "/mmkv", mmkvCachePath: "/mmkv-cache" },
}));
jest.mock("@/utils/mediaIdentity", () => ({
    getMediaUniqueKey: (item: { platform: string; id: string }) =>
        `${item.platform}@${item.id}`,
}));

import { setKeyValueStorePersistenceForTests } from "@/utils/keyValueStore";
import { encodeSnapshot } from "@/utils/keyValueStore/snapshotCodec";

const pendingReads: Array<() => void> = [];
const disk = new Map<string, string>([
    [
        "MediaExtra.kuwo",
        encodeSnapshot({
            "song-1": {
                t: "s",
                v: JSON.stringify({
                    downloaded: true,
                    downloadMetadataStatus: "failed",
                }),
            },
        }),
    ],
]);
setKeyValueStorePersistenceForTests({
    // 读盘挂起，直到测试放行
    read: id =>
        new Promise(resolve => {
            pendingReads.push(() => resolve(disk.get(id) ?? null));
        }),
    write: async (id, contents) => {
        disk.set(id, contents);
    },
    remove: async id => {
        disk.delete(id);
    },
});

const {
    useMediaExtra,
    useMediaExtraProperty,
} = require("@/utils/mediaExtra") as typeof import("@/utils/mediaExtra");

const song = { platform: "kuwo", id: "song-1" } as ICommon.IMediaBase;

const seen: { status?: unknown; extra?: unknown } = {};
function Row() {
    seen.status = useMediaExtraProperty(song, "downloadMetadataStatus");
    seen.extra = useMediaExtra(song);
    return null;
}

it("updates mounted song hooks once the platform's data has loaded", async () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
        renderer = create(<Row />);
    });
    expect(seen.status).toBeNull();
    expect(seen.extra).toBeNull();

    await act(async () => {
        pendingReads.splice(0).forEach(release => release());
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(seen.status).toBe("failed");
    expect(seen.extra).toEqual({
        downloaded: true,
        downloadMetadataStatus: "failed",
    });
    act(() => renderer?.unmount());
});
