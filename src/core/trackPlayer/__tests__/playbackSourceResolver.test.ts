import PlaybackSourceResolver from "../playbackSourceResolver";
import MediaCache from "@/core/mediaCache";
import {
    findAlternateCandidates,
    getRememberedAlternate,
    rememberAlternate,
} from "../alternateSource";

jest.mock("@/core/mediaCache", () => ({ __esModule: true, default: { removeMediaCache: jest.fn() } }));
jest.mock("@/utils/log", () => ({ errorLog: jest.fn(), trace: jest.fn() }));
jest.mock("@/utils/mediaUtils", () => ({ getMediaUniqueKey: (item: any) => `${item.platform}:${item.id}` }));
jest.mock("@/utils/qualities", () => ({
    getQualityOrder: () => ["320k", "128k"],
    convertToLegacyQuality: (key: string) => key === "320k" ? "high" : "low",
}));
jest.mock("@/utils/mediaHttpCompatibilityPolicy", () => ({ isMediaHttpAllowed: () => false }));
jest.mock("@/utils/remoteMediaUrl", () => ({ validateRemoteMediaUrlForPlayback: async (url: string) => ({ ok: true, url }) }));
jest.mock("@/service/encryptedMediaProxy", () => ({
    isUnsupportedEncryptedMediaSource: () => false,
    resolveEncryptedMediaStreamIfNeeded: async (source: unknown) => source,
}));
jest.mock("react-native-background-timer", () => ({ __esModule: true, default: { setTimeout, clearTimeout } }));
jest.mock("../alternateSource", () => ({
    getRememberedAlternate: jest.fn(), forgetAlternate: jest.fn(),
    findAlternateCandidates: jest.fn(async () => []), rememberAlternate: jest.fn(),
}));

const original = { id: "a", platform: "original", title: "Song" } as IMusic.IMusicItem;
const alternate = { id: "b", platform: "alternate", title: "Song" } as IMusic.IMusicItem;
let request: jest.Mock;
let alternateRequest: jest.Mock;
let dependencies: any;
let resolver: PlaybackSourceResolver;

beforeEach(() => {
    jest.clearAllMocks();
    request = jest.fn(async () => null);
    alternateRequest = jest.fn(async () => ({ url: "https://example.com/alternate.mp3" }));
    const originalPlugin = { name: "original", methods: { getMediaSource: request } };
    const alternatePlugin = { name: "alternate", methods: { getMediaSource: alternateRequest } };
    const plugins = {
        getByName: () => originalPlugin,
        getByMedia: () => alternatePlugin,
        isPluginEnabled: () => true,
        getSortedSearchablePlugins: () => [],
    };
    dependencies = {
        config: () => ({ getConfig: () => undefined }),
        plugins: () => plugins,
        onAlternateInUse: jest.fn(),
    };
    resolver = new PlaybackSourceResolver(dependencies);
    jest.mocked(getRememberedAlternate).mockReturnValue(alternate);
});

it("keeps original plugin ahead of embedded, direct and remembered sources", async () => {
    request.mockResolvedValue({ url: "https://example.com/plugin.mp3" });
    const result = await resolver.resolveDirectMediaSource({ ...original,
        url: "https://example.com/direct.mp3", source: { high: { url: "https://example.com/embedded.mp3" } },
    });
    expect(result).toMatchObject({ url: "https://example.com/plugin.mp3", playbackSource: { origin: "plugin", quality: "320k" } });
    expect(alternateRequest).not.toHaveBeenCalled();
    expect(dependencies.onAlternateInUse).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), null);
});

it("keeps embedded ahead of direct and remembered sources when the plugin has no source", async () => {
    const result = await resolver.resolveDirectMediaSource({ ...original,
        url: "https://example.com/direct.mp3", source: { high: { url: "https://example.com/embedded.mp3" } },
    });
    expect(result).toMatchObject({ url: "https://example.com/embedded.mp3", playbackSource: { origin: "embedded-cache" } });
    expect(alternateRequest).not.toHaveBeenCalled();
});

it("uses the remembered source for prefetch without launching a source search", async () => {
    const result = await resolver.resolveDirectMediaSource(original);
    expect(result).toMatchObject({ url: "https://example.com/alternate.mp3", playbackSource: { origin: "similar-plugin" } });
    expect(dependencies.onAlternateInUse).toHaveBeenCalledWith(original, alternate);
    expect(findAlternateCandidates).not.toHaveBeenCalled();
});

it("fresh recovery evicts original and remembered caches and ignores stale embedded sources", async () => {
    const item = { ...original, source: { high: { url: "https://example.com/stale.mp3" } } };
    const result = await resolver.resolveFreshMediaSource(item);
    expect(MediaCache.removeMediaCache).toHaveBeenNthCalledWith(1, item);
    expect(MediaCache.removeMediaCache).toHaveBeenNthCalledWith(2, alternate);
    expect(result?.url).toBe("https://example.com/alternate.mp3");
});

it("reads injected services at operation time rather than capturing startup configuration", async () => {
    dependencies.config = () => ({ getConfig: (key: string) => key === "basic.tryChangeSourceWhenPlayFail" ? false : undefined });
    expect(await resolver.resolveDirectMediaSource(original)).toBeNull();
    dependencies.plugins = () => ({ getByName: () => ({ methods: { getMediaSource: async () => ({ url: "https://example.com/new-service.mp3" }) } }) });
    expect(await resolver.resolveDirectMediaSource(original)).toMatchObject({ url: "https://example.com/new-service.mp3" });
});

it("discards a source that resolves after its playback request is invalidated", async () => {
    let release!: (source: IPlugin.IMediaSourceResult) => void;
    alternateRequest.mockImplementation(() => new Promise(resolve => {
        release = resolve; 
    }));
    let active = true;
    const result = resolver.resolveAlternateSource(original, ["320k"], () => active, jest.fn());
    active = false;
    release({ url: "https://example.com/late.mp3" });
    expect(await result).toBe("inactive");
    expect(rememberAlternate).not.toHaveBeenCalled();
    expect(dependencies.onAlternateInUse).not.toHaveBeenCalled();
});
