import fs from "fs";
import path from "path";
import { Plugin } from "../plugin";

const mockGetMediaCache = jest.fn();
const mockSetMediaCache = jest.fn();
const mockDelay = jest.fn(async (_milliseconds?: number) => undefined);

jest.mock("@/constants/commonConst", () => ({
    internalSerializeKey: Symbol.for("$"),
    localPluginPlatform: "local-file",
}));

jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: {
        cacheDir: "cache",
        dataDir: "data",
    },
}));

jest.mock("webdav", () => ({}));

jest.mock("immer", () => ({
    produce: (value: unknown) => value,
}));

jest.mock("nanoid", () => ({
    nanoid: () => "test-id",
}));

jest.mock("@/native/mp3Util", () => ({
    __esModule: true,
    default: {},
}));

jest.mock("@/core/localMusicArtworkManager", () => ({
    resolveLocalMusicArtwork: jest.fn(),
}));

jest.mock("@/core/pluginManager/meta", () => ({
    __esModule: true,
    default: {
        getUserVariables: jest.fn(() => ({})),
    },
}));

jest.mock("@/utils/fileUtils", () => ({
    addFileScheme: (value: string) => value,
    getFileName: (value: string) => value.split("/").pop() ?? value,
}));

jest.mock("@/core/mediaCache", () => ({
    __esModule: true,
    default: {
        getMediaCache: (...args: any[]) => mockGetMediaCache(...args),
        setMediaCache: (...args: any[]) => mockSetMediaCache(...args),
    },
}));

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    hydrateKeyValueStore: jest.fn(async () => undefined),
    default: () => ({
        getString: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
        delete: jest.fn(),
        getAllKeys: jest.fn(() => []),
        clearAll: jest.fn(),
    }),
}));

jest.mock("react-native-device-info", () => ({
    __esModule: true,
    default: {
        getVersion: () => "0.10.0",
    },
}));

jest.mock("react-native-fs", () => ({
    exists: jest.fn(async () => false),
    readFile: jest.fn(),
    stat: jest.fn(),
    writeFile: jest.fn(),
}));

jest.mock("react-native-url-polyfill", () => ({
    URL,
    URLSearchParams,
}));

jest.mock("@/utils/network", () => ({
    __esModule: true,
    default: {
        isOffline: false,
    },
}));

jest.mock("@/core/lxSource", () => ({
    __esModule: true,
    default: {
        isRedirectTarget: () => false,
    },
}));

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: jest.fn(),
    },
}));

jest.mock("@/utils/delay", () => ({
    __esModule: true,
    default: (milliseconds?: number) => mockDelay(milliseconds),
}));

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
    trace: jest.fn(),
    default: jest.fn(),
}));

// e2e/plugins/ 里的测试音源要在模拟器上真的被应用装上、搜到、播放。
// 这里用应用自己的插件加载代码先跑一遍，免得到模拟器上才发现插件写错了。
const ref = "0123456789abcdef0123456789abcdef01234567";

function mountE2EPlugin(file: string) {
    const source = fs.readFileSync(path.join(__dirname, "../../../../e2e/plugins", file), "utf8");
    const plugin = new Plugin(source, file);
    expect(plugin.errorMessage).toBeFalsy();
    expect([...plugin.runtimeCapabilities]).toEqual([]);
    return plugin;
}

function getMediaSource(
    plugin: Plugin,
    item: IMusic.IMusicItem,
    quality: IMusic.IQualityKey = "standard",
) {
    const getSource = plugin.methods.getMediaSource as unknown as (
        music: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
        retries: number,
        skipCacheWrite: boolean,
    ) => Promise<IPlugin.IMediaSourceResult | null>;
    return getSource.call(plugin.methods, item, quality, 0, true);
}

const fixture = (file: string) =>
    `https://raw.githubusercontent.com/CTZZG/MusicFree/${ref}/e2e/fixtures/${file}`;

describe("e2e test source A", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMediaCache.mockReturnValue(null);
    });

    it("returns nothing unless the keyword carries a commit", async () => {
        const plugin = mountE2EPlugin("e2e-source-a.js");
        expect(plugin.name).toBe("E2E 测试源 A");
        await expect(plugin.methods.search("e2e", 1, "music")).resolves.toEqual({
            isEnd: true,
            data: [],
        });
        await expect(plugin.methods.search("周杰伦", 1, "music")).resolves.toMatchObject({
            data: [],
        });
    });

    it("serves the fixtures of the searched commit and fails the broken songs", async () => {
        const plugin = mountE2EPlugin("e2e-source-a.js");
        const result = await plugin.methods.search(`e2e ${ref}`, 1, "music");
        expect(result.data.map(item => item.title)).toEqual([
            "E2E Tone A",
            "E2E Tone B",
            "E2E Tone C",
            "E2E Broken",
            "E2E Fallback",
            "E2E Live Only",
            "E2E Short",
        ]);
        const items = result.data as IMusic.IMusicItem[];
        const byTitle = (title: string) => items.find(item => item.title === title)!;
        expect(byTitle("E2E Tone A").platform).toBe("E2E 测试源 A");

        await expect(getMediaSource(plugin, byTitle("E2E Tone A"))).resolves.toMatchObject({
            url: fixture("tone-a.mp3"),
        });
        for (const title of ["E2E Broken", "E2E Fallback", "E2E Live Only"]) {
            await expect(getMediaSource(plugin, byTitle(title))).resolves.toMatchObject({
                failure: { code: "unavailable" },
            });
        }
    });

    it("has the everyday qualities but no lossless one", async () => {
        // 模拟器上先切到 320K（要成功、接着播），再选无损（要失败、保持 320K 接着播）
        const plugin = mountE2EPlugin("e2e-source-a.js");
        const result = await plugin.methods.search(`e2e ${ref}`, 1, "music");
        const toneA = (result.data as IMusic.IMusicItem[])[0];
        for (const quality of ["128k", "192k", "320k", "high"]) {
            await expect(getMediaSource(plugin, toneA, quality)).resolves.toMatchObject({
                url: fixture("tone-a.mp3"),
            });
        }
        // 应用取不到 flac 时还会用旧写法 super 再问一遍，两次都要取不到
        await expect(getMediaSource(plugin, toneA, "flac")).resolves.toMatchObject({
            failure: { code: "unavailable" },
        });
    });
});

describe("e2e test source B", () => {
    it("stays out of the normal search but answers the other-source search", async () => {
        const plugin = mountE2EPlugin("e2e-source-b.js");
        expect(plugin.name).toBe("E2E 测试源 B");
        // 还没见过提交号时，什么都不返回
        await expect(plugin.methods.search("E2E Fallback E2E Artist", 1, "music")).resolves.toMatchObject({ data: [] });

        await expect(plugin.methods.search(`e2e ${ref}`, 1, "music")).resolves.toMatchObject({ data: [] });
        const fallback = await plugin.methods.search("E2E Fallback E2E Artist", 1, "music");
        expect(fallback.data).toEqual([expect.objectContaining({
            title: "E2E Fallback",
            artist: "E2E Artist",
            duration: 181,
            platform: "E2E 测试源 B",
        })]);
        await expect(getMediaSource(plugin, fallback.data[0] as IMusic.IMusicItem)).resolves.toMatchObject({
            url: fixture("tone-b.mp3"),
        });

        const liveOnly = await plugin.methods.search("E2E Live Only E2E Artist", 1, "music");
        expect(liveOnly.data.map(item => item.title)).toEqual(["E2E Live Only (Live)"]);
        await expect(plugin.methods.search("周杰伦 晴天", 1, "music")).resolves.toMatchObject({ data: [] });
    });

    it("pairs with source A exactly as the app's same-recording rule expects", async () => {
        const { matchRecording } = require("@/utils/sameRecording");
        const a = mountE2EPlugin("e2e-source-a.js");
        const b = mountE2EPlugin("e2e-source-b.js");
        const aItems = (await a.methods.search(`e2e ${ref}`, 1, "music")).data as IMusic.IMusicItem[];
        await b.methods.search(`e2e ${ref}`, 1, "music");
        const bFallback = (await b.methods.search("E2E Fallback E2E Artist", 1, "music")).data[0];
        const bLive = (await b.methods.search("E2E Live Only E2E Artist", 1, "music")).data[0];
        const aItem = (title: string) => aItems.find(item => item.title === title);
        expect(matchRecording(aItem("E2E Fallback"), bFallback)).not.toBeNull();
        expect(matchRecording(aItem("E2E Live Only"), bLive)).toBeNull();
    });
});
