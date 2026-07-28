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
        getVersion: () => "0.7.3",
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

const musicItem = {
    id: "track-1",
    platform: "test-plugin",
    title: "Track",
    artist: "Artist",
    album: "Album",
    artwork: "",
    duration: 180,
} as IMusic.IMusicItem;

function createPlugin(
    getMediaSource: jest.Mock,
) {
    return new Plugin(
        () => ({
            platform: "test-plugin",
            cacheControl: "cache",
            supportedQualities: ["flac"],
            getMediaSource,
        }),
        "test-plugin.js",
    );
}

function invokeGetMediaSource(
    plugin: Plugin,
    quality: IMusic.IQualityKey,
    retryCount: number,
    notUpdateCache = false,
) {
    const getSource = plugin.methods.getMediaSource as unknown as (
        music: IMusic.IMusicItem,
        requestedQuality: IMusic.IQualityKey,
        retries: number,
        skipCacheWrite: boolean,
    ) => Promise<IPlugin.IMediaSourceResult | null>;
    return getSource.call(
        plugin.methods,
        musicItem,
        quality,
        retryCount,
        notUpdateCache,
    );
}

describe("plugin media source cache control", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMediaCache.mockReturnValue(null);
    });

    it("restores the resolved quality from a fresh cache write", async () => {
        const pluginGetMediaSource = jest.fn(async () => ({
            url: "https://media.example.com/track.mp3",
            quality: "192k",
        }));
        const plugin = createPlugin(pluginGetMediaSource);

        await expect(
            invokeGetMediaSource(plugin, "flac", 0),
        ).resolves.toMatchObject({
            quality: "192k",
        });
        const storedItem = mockSetMediaCache.mock.calls[0][0] as
            IMusic.IMusicItem;
        expect(storedItem?.source?.flac?.quality).toBe("192k");

        mockGetMediaCache.mockReturnValue(storedItem);
        await expect(
            invokeGetMediaSource(plugin, "flac", 0),
        ).resolves.toMatchObject({
            url: "https://media.example.com/track.mp3",
            quality: "192k",
        });
        expect(pluginGetMediaSource).toHaveBeenCalledTimes(1);
    });

    it("keeps cache writes disabled after a structured retryable failure", async () => {
        const pluginGetMediaSource = jest
            .fn()
            .mockResolvedValueOnce({
                failure: {
                    code: "network-error",
                    retryable: true,
                },
            })
            .mockResolvedValueOnce({
                url: "https://media.example.com/track.flac",
                quality: "flac",
            });
        const plugin = createPlugin(pluginGetMediaSource);

        await expect(
            invokeGetMediaSource(plugin, "flac", 1, true),
        ).resolves.toMatchObject({
            url: "https://media.example.com/track.flac",
        });
        expect(pluginGetMediaSource).toHaveBeenCalledTimes(2);
        expect(mockDelay).toHaveBeenCalledTimes(1);
        expect(mockSetMediaCache).not.toHaveBeenCalled();
    });
});
