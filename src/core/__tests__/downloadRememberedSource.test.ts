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
        cancelDownloadTask: async () => true,
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
    canProxyCencSource: (source: any) => source.url?.endsWith(".mmp4") && !!source.cek,
    canProxyQmcSource: (source: any) => source.url?.endsWith(".mflac") && !!source.ekey,
    getPlayableCencKey: (source: any) => source.cek,
    getPlayableQmcEkey: (source: any) => source.ekey,
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


const Qmc = require("@/native/qmc").default;
const { inspectQmcMediaSource } = require("@/service/encryptedMediaProxy");
const { rememberAlternate } = require("@/core/trackPlayer/alternateSource");
const mockConfig = new Map<string, unknown>();
const mockPlugins = new Map<string, any>();
const originalSource = jest.fn();
const alternateSource = jest.fn();
let sequence = 0;
function pair() {
    sequence += 1;
    const original = { id: `original-${sequence}`, platform: "A", title: `Song ${sequence}`, artist: "Artist", album: "Album", duration: 180 };
    return { original, alternate: { ...original, id: `alternate-${sequence}`, platform: "B" } };
}
async function complete(item: any) {
    downloader.download(item, "192k");
    for (let i = 0; i < 100; i += 1) {
        const task = downloader.getDownloadDiagnosticSnapshot().tasks.find((x: any) => x.id === item.id);
        if (task && ["Error", "Completed"].includes(task.status)) return task;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error("download did not settle");
}
beforeAll(() => {
    mockCommitResult = true;
    downloader.injectDependencies(
        { getConfig: (key: string) => mockConfig.get(key), setConfig: jest.fn() },
        { getByName: (name: string) => mockPlugins.get(name), getByMedia: (item: any) => mockPlugins.get(item.platform), isPluginEnabled: (plugin: any) => plugin.enabled !== false },
    );
});
beforeEach(() => {
    jest.clearAllMocks(); mockFiles.clear(); mockConfig.clear(); mockPlugins.clear();
    Cenc.decryptFile.mockImplementation(async (_from: string, to: string) => {
        mockFiles.add(to);return true;
    });
    Qmc.decryptFile.mockImplementation(async (_from: string, to: string) => {
        mockFiles.add(to);return { audioSize:1024,extension:"flac",contentType:"audio/flac" };
    });
    inspectQmcMediaSource.mockResolvedValue({ audioSize:1024,extension:"flac",contentType:"audio/flac" });
    mockConfig.set("basic.tryRememberedSourceWhenDownloadFail", true);
    originalSource.mockReset().mockResolvedValue({ failure: { code: "unavailable" } });
    alternateSource.mockReset().mockResolvedValue({ url: "https://example.com/alternate.mp3", quality: "320k", headers: { Referer: "https://example.com/" } });
    mockPlugins.set("A", { name: "A", methods: { getMediaSource: originalSource } });
    mockPlugins.set("B", { name: "B", methods: { getMediaSource: alternateSource } });
});
it("downloads through a remembered source while retaining the original identity and actual quality", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    const task = await complete(original);
    expect(task.status).toBe("Completed");
    expect(task.platform).toBe("A"); expect(task.id).toBe(original.id);
    expect(task.quality).toBe("320k");
    expect(task.resolvedSource).toEqual({ kind: "remembered", platform: "B", id: alternate.id, quality: "320k" });
    const saved = JSON.parse(mockStores.get("music.DownloadTasks").getString("terminalTasks")).find((x: any) => x.musicItem.id === original.id);
    expect(saved.resolvedSource).toEqual(task.resolvedSource);
    expect(Object.keys(saved.resolvedSource).sort()).toEqual(["id", "kind", "platform", "quality"]);
    expect(RNFS.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ fromUrl: "https://example.com/alternate.mp3", headers: expect.objectContaining({ Referer: "https://example.com/" }) }));
    expect(LocalMusicSheet.upsertMusic).toHaveBeenCalledWith(expect.objectContaining({ platform:"A",id:original.id }));
});
it("honors the download switch independently of the playback switch", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    mockConfig.set("basic.tryRememberedSourceWhenDownloadFail", false);
    mockConfig.set("basic.tryChangeSourceWhenPlayFail", true);
    expect((await complete(original)).status).toBe("Error");
    expect(alternateSource).not.toHaveBeenCalled();
});
it("still uses the remembered source when only playback source changing is disabled", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    mockConfig.set("basic.tryChangeSourceWhenPlayFail", false);
    expect((await complete(original)).status).toBe("Completed");
});
it("prefers a recovered original source", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    originalSource.mockResolvedValue({ url:"https://example.com/original.mp3",quality:"192k" });
    expect((await complete(original)).status).toBe("Completed");
    expect(alternateSource).not.toHaveBeenCalled();
    expect(RNFS.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ fromUrl:"https://example.com/original.mp3" }));
});
it("keeps a usable embedded original URL ahead of a remembered source", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    expect((await complete({ ...original,url:"https://example.com/direct.mp3" })).status).toBe("Completed");
    expect(alternateSource).not.toHaveBeenCalled();
});
it.each(["disabled", "removed", "mismatch"])("rejects a %s remembered source", async reason => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    if (reason === "disabled") mockPlugins.get("B").enabled=false;
    if (reason === "removed") mockPlugins.delete("B");
    if (reason === "mismatch") original.title += " (Live)";
    expect((await complete(original)).status).toBe("Error");
    expect(alternateSource).not.toHaveBeenCalled();
});
it("does not download a late result after the attempt is removed", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    let reply!: (value: any) => void;
    originalSource.mockReturnValue(new Promise(resolve => {
        reply=resolve;
    }));
    downloader.download(original,"192k");
    await new Promise(resolve => setTimeout(resolve,0));
    expect(downloader.remove(original)).toBe(true);
    reply({ failure:{ code:"unavailable" } });
    await new Promise(resolve => setTimeout(resolve,10));
    expect(alternateSource).not.toHaveBeenCalled();
    expect(originalSource).toHaveBeenCalledTimes(1);
    expect(RNFS.downloadFile).not.toHaveBeenCalled();
});

it("decrypts CENC from the alternate using its key and retains the original library identity", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    const cek="00112233445566778899aabbccddeeff";
    alternateSource.mockResolvedValue({ url:"https://example.com/alternate.mmp4",cek,quality:"320k" });
    const task=await complete({ ...original,cek:"old-key" });
    expect(task.status).toBe("Completed");
    expect(task.filename).toBeDefined();
    expect(Cenc.decryptFile).toHaveBeenCalledWith(expect.stringMatching(/\.cenc$/),expect.stringMatching(/\.m4a$/),cek);
    expect(LocalMusicSheet.upsertMusic).toHaveBeenCalledWith(expect.objectContaining({ id:original.id,platform:"A" }));
});
it("probes and decrypts QMC using the alternate's headers and ekey", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    alternateSource.mockResolvedValue({ url:"https://example.com/alternate.mflac",ekey:"new-key",quality:"flac",headers:{ Referer:"https://alternate.example/" },userAgent:"Alternate Agent" });
    const task=await complete({ ...original,ekey:"old-key" });
    expect(task.status).toBe("Completed");
    expect(task.quality).toBe("flac");
    expect(inspectQmcMediaSource).toHaveBeenCalledWith(expect.objectContaining({ ekey:"new-key",headers:{ Referer:"https://alternate.example/","User-Agent":"Alternate Agent" } }));
    expect(Qmc.decryptFile).toHaveBeenCalledWith(expect.stringMatching(/\.qmc$/),expect.stringMatching(/\.flac$/),"new-key");
});
it("fails without starting a download if all encrypted candidates are unsupported", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    alternateSource.mockResolvedValue({ url:"https://example.com/alternate.mflac" });
    const task=await complete(original);
    expect(task.status).toBe("Error");
    expect(task.errorReason).toBe("encrypted-media-unsupported");
    expect(RNFS.downloadFile).not.toHaveBeenCalled();
});

it("enables remembered download sources by default", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    mockConfig.delete("basic.tryRememberedSourceWhenDownloadFail");
    expect((await complete(original)).status).toBe("Completed");
});
it("uses the download quality order for the alternate rather than the playback order", async () => {
    const { original, alternate } = pair(); rememberAlternate(original, alternate);
    mockConfig.set("basic.downloadQualityOrder","desc");
    mockConfig.set("basic.playQualityOrder","asc");
    alternateSource.mockImplementation(async (_item: any, quality: string) => quality === "128k" ? { url:"https://example.com/low.mp3",quality:"128k" } : { failure:{ code:"unavailable" } });
    const task=await complete(original);
    expect(task.status).toBe("Completed");
    expect(task.quality).toBe("128k");
    expect(alternateSource.mock.calls.slice(0,2).map((args: any[]) => args[1])).toEqual(["192k","128k"]);
});

it("does not call a remembered plugin uninstalled while the original request waits", async () => {
    const { original, alternate }=pair(); rememberAlternate(original,alternate);
    let reply!: (value: any) => void;
    originalSource.mockReturnValueOnce(new Promise(resolve => {
        reply=resolve;
    }));
    const loading=complete(original);
    await new Promise(resolve => setTimeout(resolve,0));
    mockPlugins.delete("B");
    reply({ failure:{ code:"unavailable" } });
    expect((await loading).status).toBe("Error");
    expect(alternateSource).not.toHaveBeenCalled();
});
