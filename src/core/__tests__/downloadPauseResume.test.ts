export {};

const mockFiles = new Set<string>();
const mockStores = new Map<string, any>();
const mockNativeListeners: Record<string, Array<(payload: any) => void>> = {};
const mockNativeAddDownloadTask = jest.fn();
const mockNativePauseDownloadTask = jest.fn();
const mockNativeCancelDownloadTask = jest.fn();
const mockNativeRemoveDownloadTask = jest.fn();
const mockNativeGetDownloadTaskStatus = jest.fn();

function emitNativeEvent(event: string, payload: any) {
    (mockNativeListeners[event] ?? []).forEach(listener => listener(payload));
}

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
                flush: jest.fn(async () => true),
            });
        }
        return mockStores.get(id);
    },
}));
jest.mock("react-native-fs", () => ({
    __esModule: true,
    exists: jest.fn(async (filePath: string) => mockFiles.has(filePath)),
    unlink: jest.fn(async (filePath: string) => {
        mockFiles.delete(filePath);
    }),
    copyFile: jest.fn(async (_from: string, to: string) => {
        mockFiles.add(to);
    }),
    stat: jest.fn(async (filePath: string) => {
        if (!mockFiles.has(filePath)) {
            throw new Error("ENOENT");
        }
        return { size: 4096 };
    }),
    writeFile: jest.fn(async () => undefined),
    stopDownload: jest.fn(),
    downloadFile: jest.fn(),
}));
jest.mock("@/utils/fileUtils", () => ({
    __esModule: true,
    addFileScheme: (filePath: string) =>
        filePath.startsWith("file://") ? filePath : `file://${filePath}`,
    removeFileScheme: (filePath: string) => filePath.replace(/^file:\/\//, ""),
    escapeCharacter: (value: string) => `${value ?? ""}`,
    getFileName: (filePath: string) => filePath.split("/").pop(),
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
        isNativeDownloadAvailable: () => true,
        setDownloadMaxConcurrency: jest.fn(async () => true),
        getAllDownloadTasks: jest.fn(async () => []),
        addDownloadTask: (...args: any[]) => mockNativeAddDownloadTask(...args),
        pauseDownloadTask: (...args: any[]) => mockNativePauseDownloadTask(...args),
        cancelDownloadTask: (...args: any[]) =>
            mockNativeCancelDownloadTask(...args),
        removeDownloadTask: (...args: any[]) =>
            mockNativeRemoveDownloadTask(...args),
        getDownloadTaskStatus: (...args: any[]) =>
            mockNativeGetDownloadTaskStatus(...args),
    },
    getMp3UtilNativeDiagnostics: () => ({}),
    NativeDownloadEmitter: {
        addListener: jest.fn((event: string, cb: (payload: any) => void) => {
            mockNativeListeners[event] = mockNativeListeners[event] ?? [];
            mockNativeListeners[event].push(cb);
            return {
                remove: () => {
                    mockNativeListeners[event] = (
                        mockNativeListeners[event] ?? []
                    ).filter(item => item !== cb);
                },
            };
        }),
    },
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
const LocalMusicSheet = require("@/core/localMusicSheet").default;
const downloader = require("@/core/downloader").default;

const makeSong = (id: string) => ({
    id,
    platform: "test",
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    url: `https://example.com/${id}.mp3`,
});

async function flushMicrotasks(rounds = 15) {
    for (let i = 0; i < rounds; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
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
    Object.keys(mockNativeListeners).forEach(key => {
        mockNativeListeners[key] = [];
    });
    mockNativeAddDownloadTask.mockResolvedValue(true);
    mockNativePauseDownloadTask.mockResolvedValue(true);
    mockNativeCancelDownloadTask.mockImplementation(async (taskId: string) => {
        queueMicrotask(() => {
            emitNativeEvent("NativeDownloadTaskStatusChanged", {
                taskId,
                status: "CANCELED",
                downloaded: 0,
                total: 0,
            });
        });
        return true;
    });
    mockNativeRemoveDownloadTask.mockResolvedValue(true);
    mockNativeGetDownloadTaskStatus.mockResolvedValue(null);
});

describe("Downloader post-commit tolerance and native pause/resume", () => {
    it("does not roll back or delete completed file if post-commit removeNativeTask rejects", async () => {
        const song = makeSong("post-commit-keep");
        mockNativeAddDownloadTask.mockImplementation(async (params: any) => {
            mockFiles.add(params.destinationPath);
            queueMicrotask(() => {
                emitNativeEvent("NativeDownloadTaskStatusChanged", {
                    taskId: params.taskId,
                    status: "COMPLETED",
                    downloaded: 4096,
                    total: 4096,
                });
            });
            return true;
        });
        // First removeDownloadTask resets slot in downloadFileWithNative; post-commit remove fails.
        let removeCalls = 0;
        mockNativeRemoveDownloadTask.mockImplementation(async () => {
            removeCalls += 1;
            if (removeCalls >= 2) {
                throw new Error("bridge busy timeout");
            }
            return true;
        });

        downloader.download(song);
        await flushMicrotasks(30);

        const snap = downloader
            .getDownloadDiagnosticSnapshot()
            .tasks.find((item: any) => item.id === song.id);
        expect(snap?.status).toBe("Completed");
        expect(RNFS.copyFile).toHaveBeenCalledTimes(1);
        const copiedTarget = RNFS.copyFile.mock.calls[0][1];
        expect(mockFiles.has(copiedTarget)).toBe(true);
        expect(LocalMusicSheet.removeMusicIfLocalPath).not.toHaveBeenCalled();

        downloader.clearCompletedTasks([song]);
    });

    it("preserves partialCachePath and progress across pause/resume and cleans it on remove", async () => {
        const song = makeSong("pause-resume");
        const addedTasks: Array<{ taskId: string; destinationPath: string }> =
            [];
        mockNativeAddDownloadTask.mockImplementation(async (params: any) => {
            addedTasks.push({
                taskId: params.taskId,
                destinationPath: params.destinationPath,
            });
            mockFiles.add(params.destinationPath);
            queueMicrotask(() => {
                emitNativeEvent("NativeDownloadProgressBatch", {
                    items: [
                        {
                            taskId: params.taskId,
                            downloaded: 2048,
                            total: 4096,
                            percent: 50,
                            progressText: "50%",
                        },
                    ],
                });
            });
            return true;
        });

        downloader.download(song);
        await flushMicrotasks(25);
        expect(addedTasks).toHaveLength(1);
        const firstAttempt = addedTasks[0];
        mockNativeRemoveDownloadTask.mockClear();

        const paused = await downloader.pause(song);
        expect(paused).toBe(true);
        emitNativeEvent("NativeDownloadTaskStatusChanged", {
            taskId: firstAttempt.taskId,
            status: "PAUSED",
            downloaded: 2048,
            total: 4096,
        });
        await flushMicrotasks(20);

        // Pausing must NOT remove the native task or delete the cached partial file.
        expect(mockNativePauseDownloadTask).toHaveBeenCalledWith(
            firstAttempt.taskId,
        );
        expect(mockNativeRemoveDownloadTask).not.toHaveBeenCalledWith(
            firstAttempt.taskId,
        );
        expect(mockFiles.has(firstAttempt.destinationPath)).toBe(true);

        const pausedSnap = downloader
            .getDownloadDiagnosticSnapshot()
            .tasks.find((item: any) => item.id === song.id);
        expect(pausedSnap?.status).toBe("Paused");
        expect(pausedSnap?.downloadedSize).toBe(2048);

        // Resume reuses the exact partial cache path for the new attempt.
        const resumed = await downloader.resume(song);
        expect(resumed).toBe(true);
        await flushMicrotasks(25);
        expect(addedTasks).toHaveLength(2);
        expect(addedTasks[1].destinationPath).toBe(
            firstAttempt.destinationPath,
        );

        // Removing the task cancels and unlinks the partial cache file.
        expect(downloader.remove(song)).toBe(true);
        await flushMicrotasks(15);
        expect(RNFS.unlink).toHaveBeenCalledWith(firstAttempt.destinationPath);
        expect(mockFiles.has(firstAttempt.destinationPath)).toBe(false);
    });

    it("unlinks stale partialCachePath when resumed source changes asset path and allows rotated query tokens", async () => {
        const song = makeSong("source-switch");
        song.url = "https://cdn.example.com/v1/track.mp3?sig=alpha";
        const addedTasks: Array<{ taskId: string; destinationPath: string }> = [];
        mockNativeAddDownloadTask.mockImplementation(async (params: any) => {
            addedTasks.push({
                taskId: params.taskId,
                destinationPath: params.destinationPath,
            });
            mockFiles.add(params.destinationPath);
            return true;
        });

        downloader.download(song);
        await flushMicrotasks(20);
        expect(addedTasks).toHaveLength(1);
        const initialPath = addedTasks[0].destinationPath;

        await downloader.pause(song);
        emitNativeEvent("NativeDownloadTaskStatusChanged", {
            taskId: addedTasks[0].taskId,
            status: "PAUSED",
            downloaded: 1024,
            total: 4096,
        });
        await flushMicrotasks(15);

        // Rotating query signature on the same asset path reuses the partial file.
        song.url = "https://cdn.example.com/v1/track.mp3?sig=beta";
        await downloader.resume(song);
        await flushMicrotasks(20);
        expect(addedTasks).toHaveLength(2);
        expect(addedTasks[1].destinationPath).toBe(initialPath);

        // Switching to a different asset path on resume discards the old partial file.
        await downloader.pause(song);
        emitNativeEvent("NativeDownloadTaskStatusChanged", {
            taskId: addedTasks[1].taskId,
            status: "PAUSED",
            downloaded: 2048,
            total: 4096,
        });
        await flushMicrotasks(15);

        RNFS.unlink.mockClear();
        song.url = "https://cdn.example.com/v2/remaster.mp3?sig=gamma";
        await downloader.resume(song);
        await flushMicrotasks(20);
        expect(addedTasks).toHaveLength(3);
        expect(addedTasks[2].destinationPath).not.toBe(initialPath);
        expect(RNFS.unlink).toHaveBeenCalledWith(initialPath);

        downloader.remove(song);
        await flushMicrotasks(15);
        expect(downloader.getDownloadDiagnosticSnapshot().downloadingCount).toBe(0);
    });
});
