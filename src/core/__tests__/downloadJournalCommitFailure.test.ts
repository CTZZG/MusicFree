/**
 * 复核 1ec0114c（P2）：开始写最终文件之前要先让“准备收尾”落盘，但提交的结果
 * 没人看：写不进去照样复制、解密出最终文件。这时进程被杀，磁盘上没有这次
 * 收尾的日志，重启后没人知道这个文件要接着做还是删掉。
 *
 * 真实的下载器和收尾事务走一遍完整下载：歌曲自带地址、非原生下载、文件系统
 * 是内存里的假实现，下载任务的存储提交（flush）返回失败。
 */
export {};

const mockFiles = new Set<string>();
const mockStores = new Map<string, any>();
let mockCommitResult = false;

function mockAutoStub(): any {
    const cache: Record<string | symbol, unknown> = {};
    return new Proxy(cache, {
        get(target, key) {
            if (key === "__esModule") {
                return true;
            }
            if (key === "then") {
                return undefined;
            }
            if (!(key in target)) {
                target[key] = key === "default" ? mockAutoStub() : jest.fn();
            }
            return target[key];
        },
    });
}

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: (id: string) => {
        if (!mockStores.has(id)) {
            const data = new Map<string, string>();
            mockStores.set(id, {
                getString: (key: string) => data.get(key),
                set: (key: string, value: string) => data.set(key, value),
                delete: (key: string) => data.delete(key),
                contains: (key: string) => data.has(key),
                getAllKeys: () => [...data.keys()],
                flush: jest.fn(async () => mockCommitResult),
            });
        }
        return mockStores.get(id);
    },
}));
jest.mock("react-native-fs", () => ({
    __esModule: true,
    exists: jest.fn(async (path: string) => mockFiles.has(path)),
    unlink: jest.fn(async (path: string) => {
        mockFiles.delete(path);
    }),
    copyFile: jest.fn(async (_from: string, to: string) => {
        mockFiles.add(to);
    }),
    stat: jest.fn(async (path: string) => {
        if (!mockFiles.has(path)) {
            throw new Error("ENOENT");
        }
        return { size: 1024 };
    }),
    writeFile: jest.fn(async () => undefined),
    stopDownload: jest.fn(),
    downloadFile: jest.fn(({ toFile }: { toFile: string }) => {
        mockFiles.add(toFile);
        return { jobId: 1, promise: Promise.resolve({ statusCode: 200 }) };
    }),
}));
jest.mock("@/utils/fileUtils", () => ({
    __esModule: true,
    addFileScheme: (path: string) =>
        path.startsWith("file://") ? path : `file://${path}`,
    removeFileScheme: (path: string) => path.replace(/^file:\/\//, ""),
    escapeCharacter: (value: string) => `${value ?? ""}`,
    getFileName: (path: string) => path.split("/").pop(),
    mkdirR: jest.fn(async () => undefined),
}));
jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: {
        basePath: "/app",
        downloadCachePath: "/app/cache/download/",
        downloadMusicPath: "/music/",
    },
}));
jest.mock("@/utils/network", () => ({
    __esModule: true,
    default: { isOffline: false, isCellular: false },
}));
jest.mock("@/native/mp3Util", () => ({
    __esModule: true,
    default: {
        isNativeDownloadAvailable: () => false,
        removeDownloadTask: async () => true,
    },
    getMp3UtilNativeDiagnostics: () => ({}),
    NativeDownloadEmitter: null,
}));
jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    Easing: { out: () => () => 0, inOut: () => () => 0, bezier: () => () => 0 },
}));
let mockIdCounter = 0;
jest.mock("nanoid", () => ({
    __esModule: true,
    nanoid: () => `id${(mockIdCounter += 1)}`,
}));
jest.mock("@/utils/log", () => mockAutoStub());
jest.mock("@/utils/mediaExtra", () => mockAutoStub());
jest.mock("@/native/cenc", () => mockAutoStub());
jest.mock("@/native/qmc", () => mockAutoStub());
jest.mock("@/service/encryptedMediaProxy", () => ({
    __esModule: true,
    canProxyCencSource: () => false,
    canProxyQmcSource: () => false,
    getPlayableCencKey: () => undefined,
    getPlayableQmcEkey: () => undefined,
    inspectQmcMediaSource: jest.fn(),
}));
jest.mock("@/core/localMusicSheet", () => ({
    __esModule: true,
    default: {
        getMusicList: () => [],
        upsertMusic: jest.fn(async () => undefined),
        removeMusic: jest.fn(async () => undefined),
        removeMusicIfLocalPath: jest.fn(async () => undefined),
    },
}));
jest.mock("@/core/musicMetadataManager", () => ({
    __esModule: true,
    default: {
        injectPluginManager: () => undefined,
        isAvailable: () => false,
        getDownloadEnrichment: async () => ({}),
        writeMetadataForDownloadTask: async () => ({ success: true }),
    },
}));
jest.mock("@/core/downloadNotificationManager", () => ({
    __esModule: true,
    default: {
        prepareForDownload: async () => undefined,
        showDownloadNotification: async () => undefined,
        updateProgress: async () => undefined,
        showCompleted: async () => undefined,
        showError: async () => undefined,
        cancelNotification: async () => undefined,
    },
}));

const RNFS = require("react-native-fs");
const Cenc = require("@/native/cenc").default;
const LocalMusicSheet = require("@/core/localMusicSheet").default;
const downloader = require("@/core/downloader").default;

const song = (id: string) => ({
    id,
    platform: "test",
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    url: `https://example.com/${id}.mp3`,
});

async function downloadOnce(id: string) {
    downloader.download(song(id));
    for (let i = 0; i < 50; i += 1) {
        const task = downloader
            .getDownloadDiagnosticSnapshot()
            .tasks.find((item: any) => item.id === id);
        if (task && ["Error", "Completed"].includes(task.status)) {
            return task;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error("download did not finish");
}

beforeAll(() => {
    downloader.injectDependencies(
        { getConfig: () => undefined, setConfig: jest.fn() },
        { getByName: () => undefined, getByMedia: () => undefined },
    );
});

beforeEach(() => {
    jest.clearAllMocks();
    mockFiles.clear();
});

it("does not create the final file when the journal cannot be saved", async () => {
    mockCommitResult = false;

    const task = await downloadOnce("first");

    expect(task.status).toBe("Error");
    // 最终文件一个字节都没写：没复制、没解密
    expect(RNFS.copyFile).not.toHaveBeenCalled();
    expect(Cenc.decryptFile).not.toHaveBeenCalled();
    expect([...mockFiles].filter(file => file.startsWith("/music/"))).toEqual([]);
    // 只删了这次下载自己的缓存，没按回滚去删最终路径、歌词文件，也没动本地歌单
    const removed = RNFS.unlink.mock.calls.map(([path]: [string]) => path);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((path: string) => path.startsWith("/app/cache/download/"))).toBe(true);
    expect(LocalMusicSheet.removeMusicIfLocalPath).not.toHaveBeenCalled();
    expect(mockFiles.size).toBe(0);
});

it("finishes the download when the journal is saved", async () => {
    mockCommitResult = true;

    const task = await downloadOnce("second");

    expect(task.status).toBe("Completed");
    expect(RNFS.copyFile).toHaveBeenCalledTimes(1);
});
