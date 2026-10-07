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
const pluginSource = fs.readFileSync(
    path.join(__dirname, "../../../../e2e/plugins/e2e-source-a.js"),
    "utf8",
);
const ref = "0123456789abcdef0123456789abcdef01234567";

function mountE2EPlugin() {
    const plugin = new Plugin(pluginSource, "e2e-source-a.js");
    expect(plugin.errorMessage).toBeFalsy();
    return plugin;
}

function getMediaSource(plugin: Plugin, item: IMusic.IMusicItem) {
    const getSource = plugin.methods.getMediaSource as unknown as (
        music: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
        retries: number,
        skipCacheWrite: boolean,
    ) => Promise<IPlugin.IMediaSourceResult | null>;
    return getSource.call(plugin.methods, item, "standard", 0, true);
}

describe("e2e test plugin", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMediaCache.mockReturnValue(null);
    });

    it("mounts through the string plugin path without asking for capabilities", () => {
        const plugin = mountE2EPlugin();
        expect(plugin.name).toBe("E2E 测试源 A");
        expect([...plugin.runtimeCapabilities]).toEqual([]);
    });

    it("returns nothing unless the keyword carries a commit", async () => {
        const plugin = mountE2EPlugin();
        await expect(plugin.methods.search("e2e", 1, "music")).resolves.toEqual({
            isEnd: true,
            data: [],
        });
        await expect(plugin.methods.search("周杰伦", 1, "music")).resolves.toMatchObject({
            data: [],
        });
    });

    it("serves the fixtures of the searched commit and fails the broken song", async () => {
        const plugin = mountE2EPlugin();
        const result = await plugin.methods.search(`e2e ${ref}`, 1, "music");
        expect(result.data.map(item => item.title)).toEqual([
            "E2E Tone A",
            "E2E Tone B",
            "E2E Tone C",
            "E2E Broken",
            "E2E Short",
        ]);
        const [toneA, , , broken] = result.data as IMusic.IMusicItem[];
        expect(toneA.platform).toBe("E2E 测试源 A");

        await expect(getMediaSource(plugin, toneA)).resolves.toMatchObject({
            url: `https://raw.githubusercontent.com/CTZZG/MusicFree/${ref}/e2e/fixtures/tone-a.mp3`,
        });
        await expect(getMediaSource(plugin, broken)).resolves.toMatchObject({
            failure: { code: "unavailable" },
        });
    });
});
