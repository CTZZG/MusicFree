import { MusicVideoCancelled, MusicVideoSources, normalizeVideoQualities } from "../musicVideoSource";
import type { Plugin } from "../plugin";
import { notifyPluginEnabledChanged } from "../enabledRevision";

const song = { id: "song-a", platform: "QQ", title: "Song", artist: "Artist", mv: "mv-1" };
const candidate = { id: "mv-1", title: "Song MV", qualities: [{ id: "720p", label: "720p" }] };
const media = { url: "https://cdn.example.com/video.mp4", videoQuality: "720p" };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

function setup(legacy = false, policy = "no-cache") {
    let revision = 0;
    let enabled = true;
    const plugin = {
        name: "QQ", hash: "fixed-plugin-hash", instance: { cacheControl: policy, supportedVideoQualities: ["720p", "1080p"] },
        supportedMethods: new Set(legacy ? ["getMvSource"] : ["getMusicVideos", "getVideoSource"]),
        methods: {
            getMusicVideos: jest.fn(async (_song: IMusic.IMusicItemBase): Promise<IPlugin.IVideoCandidate[]> => [candidate]),
            getVideoSource: jest.fn(async (_video: IPlugin.IVideoCandidate, _quality?: string): Promise<IPlugin.IVideoSourceResult> => media),
            getMvSource: jest.fn(async (_song: IMusic.IMusicItemBase, _quality?: string): Promise<IPlugin.IVideoSourceResult> => media),
        },
    };
    let installed = plugin;
    const manager = { getByMedia: () => installed as unknown as Plugin, getByName: () => installed as unknown as Plugin, isPluginEnabled: () => enabled };
    const service = new MusicVideoSources(manager, () => revision, () => 1000000);
    return { service, plugin, disableAndEnable: () => {
        enabled = false; revision++; enabled = true; revision++;
    },
    replace: () => {
        installed = { ...plugin };
    } };
}

describe("optional music video sources", () => {
    it("keeps legacy song/mv identities and does not resolve a stream before selection", async () => {
        const { service, plugin } = setup(true);
        const list = await service.find(song, () => true);
        expect(list).toHaveLength(1);
        expect(plugin.methods.getMvSource).not.toHaveBeenCalled();
        expect(list[0]).toMatchObject({ id: "mv-1", originalSongKey: "QQ@song-a", providerKey: "fixed-plugin-hash", version: "other" });
        const result = await service.resolve(list[0], undefined, () => true);
        expect(plugin.methods.getMvSource).toHaveBeenCalledWith(song, "720p");
        expect(result.source.url).toBe(media.url);
        expect(result.source.timelineId).toBeUndefined();
        expect(song).not.toHaveProperty("url");
    });

    it("supports the optional method pair without routing through audio source methods", async () => {
        const { service, plugin } = setup();
        const [item] = await service.find(song, () => true);
        await service.resolve(item, "720p", () => true);
        expect(plugin.methods.getMusicVideos).toHaveBeenCalledWith(song);
        expect(plugin.methods.getMvSource).not.toHaveBeenCalled();
        expect(plugin.methods.getVideoSource.mock.calls[0][0]).not.toHaveProperty("providerKey");
    });

    it("treats old audio-only plugins as having no MV entry", () => {
        const { service, plugin } = setup();
        plugin.supportedMethods.clear();
        expect(service.supports(song)).toBe(false);
    });

    it("normalizes finite declarations and preserves opaque quality keys", () => {
        expect(normalizeVideoQualities([{ key: "30", label: "720p", height: 0 }, { key: "30", label: "duplicate" }, { id: "x", label: "X", height: Infinity }]))
            .toEqual([{ id: "30", label: "720p", height: undefined, bitrate: undefined }, { id: "x", label: "X", height: undefined, bitrate: undefined }]);
    });

    it("caches metadata while resolving a fresh URL on every actual play request", async () => {
        const { service, plugin } = setup(false, "cache");
        const [item] = await service.find(song, () => true);
        await service.find(song, () => true);
        await service.resolve(item, undefined, () => true);
        await service.resolve(item, undefined, () => true);
        expect(plugin.methods.getMusicVideos).toHaveBeenCalledTimes(1);
        expect(plugin.methods.getVideoSource).toHaveBeenCalledTimes(2);
    });

    it.each(["no-store", "no-cache"])("respects %s metadata policy", async policy => {
        const { service, plugin } = setup(false, policy);
        await service.find(song, () => true); await service.find(song, () => true);
        expect(plugin.methods.getMusicVideos).toHaveBeenCalledTimes(2);
    });

    it("rejects a late result after disable-enable even if the same plugin is enabled again", async () => {
        const { service, plugin, disableAndEnable } = setup();
        const source = deferred<typeof media>();
        plugin.methods.getVideoSource.mockReturnValueOnce(source.promise);
        const [item] = await service.find(song, () => true);
        const result = service.resolve(item, undefined, () => true);
        await Promise.resolve(); disableAndEnable(); source.resolve(media);
        await expect(result).rejects.toBeInstanceOf(MusicVideoCancelled);
    });

    it("rejects stale plugin instances and forged candidates", async () => {
        const { service, replace } = setup();
        const [item] = await service.find(song, () => true); replace();
        await expect(service.resolve(item, undefined, () => true)).rejects.toBeInstanceOf(MusicVideoCancelled);
        await expect(service.resolve({ ...item }, undefined, () => true)).rejects.toBeInstanceOf(MusicVideoCancelled);
    });

    it("cancels a hanging request without waiting for its late result", async () => {
        const { service, plugin } = setup();
        const promise = deferred<typeof media>();
        plugin.methods.getVideoSource.mockReturnValueOnce(promise.promise);
        const [item] = await service.find(song, () => true);
        const abort = new AbortController();
        const result = service.resolve(item, undefined, () => true, abort.signal); abort.abort();
        await expect(result).rejects.toBeInstanceOf(MusicVideoCancelled);
        promise.resolve(media);
    });

    it("stops waiting immediately when installed plugin configuration changes", async () => {
        const { service, plugin } = setup();
        const promise = deferred<typeof media>();
        plugin.methods.getVideoSource.mockReturnValueOnce(promise.promise);
        const [item] = await service.find(song, () => true);
        const result = service.resolve(item, undefined, () => true);
        await Promise.resolve(); notifyPluginEnabledChanged();
        await expect(result).rejects.toBeInstanceOf(MusicVideoCancelled);
        promise.resolve(media);
    });

    it("does not cache a query error as an empty result", async () => {
        const { service, plugin } = setup(false, "cache");
        plugin.methods.getMusicVideos.mockRejectedValueOnce(new Error("network"));
        await expect(service.find(song, () => true)).rejects.toThrow("network");
        expect(await service.find(song, () => true)).toHaveLength(1);
    });

    it("does not cache a legacy structured network failure as no MV", async () => {
        const { service, plugin } = setup(true, "cache");
        const unknown = { ...song, mv: "" };
        plugin.methods.getMvSource.mockResolvedValueOnce({ failure: { code: "network-error" } });
        await expect(service.find(unknown, () => true)).rejects.toMatchObject({ code: "network-error" });
        expect(await service.find(unknown, () => true)).toHaveLength(1);
        expect(plugin.methods.getMvSource).toHaveBeenCalledTimes(2);
    });

    it("keeps quality metadata immutable and refuses temporary URLs as video identity", async () => {
        const { service, plugin } = setup();
        plugin.methods.getMusicVideos.mockResolvedValueOnce([{ ...candidate, id: "https://cdn.example.com/temporary.mp4?token=x" }, candidate]);
        const list = await service.find(song, () => true);
        expect(list).toHaveLength(1);
        expect(Object.isFrozen(list[0].qualities)).toBe(true);
        expect(Object.isFrozen(list[0].qualities?.[0])).toBe(true);
    });

    it("enriches legacy qualities using real source keys without inventing a timeline", async () => {
        const { service, plugin } = setup(true);
        plugin.methods.getMvSource.mockResolvedValueOnce({ ...media, availableVideoQualities: [{ key: "30", label: "720p" }, { key: "10", label: "360p" }] } as typeof media);
        const [item] = await service.find(song, () => true);
        const resolved = await service.resolve(item, undefined, () => true);
        expect(resolved.quality).toBe("30");
        await service.resolve(resolved.candidate, "10", () => true);
        expect(plugin.methods.getMvSource).toHaveBeenLastCalledWith(song, "10");
        expect(resolved.source.timelineId).toBeUndefined();
    });

    it("rejects undeclared qualities and unverified segmented streams", async () => {
        const { service, plugin } = setup();
        const [item] = await service.find(song, () => true);
        await expect(service.resolve(item, "4k", () => true)).rejects.toMatchObject({ code: "source-rejected" });
        plugin.methods.getVideoSource.mockResolvedValueOnce({ url: "https://cdn.example.com/live.m3u8", videoQuality: "720p" });
        await expect(service.resolve(item, undefined, () => true)).rejects.toMatchObject({ code: "source-rejected" });
    });

    it("bounds list size and rejects malformed metadata without trusting internal fields", async () => {
        const { service, plugin } = setup();
        plugin.methods.getMusicVideos.mockResolvedValueOnce([
            { ...candidate, providerKey: "forged" } as IPlugin.IVideoCandidate,
            candidate, { id: "", title: "bad" },
            ...Array.from({ length: 70 }, (_, i) => ({ id: `v-${i}`, title: `V${i}` })),
        ]);
        const items = await service.find(song, () => true);
        expect(items.length).toBeLessThanOrEqual(50);
        expect(new Set(items.map(v => v.id)).size).toBe(items.length);
        expect(items.every(v => v.providerKey === "fixed-plugin-hash")).toBe(true);
    });

    it("returns from a hanging source at the unchanged 15-second contract limit", async () => {
        jest.useFakeTimers();
        try {
            const { service, plugin } = setup();
            plugin.methods.getVideoSource.mockReturnValueOnce(new Promise(() => {}));
            const [item] = await service.find(song, () => true);
            const result = service.resolve(item, undefined, () => true);
            const settled = result.then(() => null, error => error);
            await jest.advanceTimersByTimeAsync(15000);
            expect(await settled).toMatchObject({ name: "TimeoutError" });
        } finally {
            jest.useRealTimers();
        }
    });
});
