const mockRemembered = new Map<string, unknown>();
jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: { get: (key: string) => mockRemembered.get(key), set: (key: string, value: unknown) => mockRemembered.set(key, value) },
}));

import { resolveDownloadMediaSource } from "../downloadSource";
import { rememberAlternate } from "../alternateSource";
import { withTimeout } from "@/utils/promiseTimeout";

const original = { id: "a", platform: "A", title: "Song", artist: "Artist", duration: 180 } as IMusic.IMusicItem;
const alternate = { ...original, id: "b", platform: "B" };
const a = { name: "A", methods: { getMediaSource: jest.fn() } };
const b = { name: "B", methods: { getMediaSource: jest.fn() } };
const manager = {
    getByName: () => a,
    getByMedia: () => b,
    isPluginEnabled: () => true,
};
const options = () => ({
    musicItem: original,
    qualityOrder: ["192k", "320k"],
    pluginManager: manager,
    useRemembered: true,
    isActive: () => true,
    prepare: async (source: IPlugin.IMediaSourceResult) => source,
});
const later = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

beforeEach(() => {
    jest.useFakeTimers();
    mockRemembered.clear();
    a.methods.getMediaSource.mockReset().mockResolvedValue({ failure: { code: "unavailable" } });
    b.methods.getMediaSource.mockReset().mockResolvedValue({ url: "https://example.com/b.mp3" });
    rememberAlternate(original, alternate);
});
afterEach(() => jest.useRealTimers());

it("tries original qualities within 9 seconds while preserving the remembered source's reserved budget", async () => {
    a.methods.getMediaSource.mockImplementation(() => new Promise(() => {}));
    const loading = resolveDownloadMediaSource(options());
    await jest.advanceTimersByTimeAsync(9000);
    expect(await loading).toMatchObject({ identity: { kind: "remembered", platform: "B" } });
    expect(a.methods.getMediaSource).toHaveBeenCalledTimes(2);
});

it("bounds two hung sources within the 15-second total budget", async () => {
    a.methods.getMediaSource.mockImplementation(() => new Promise(() => {}));
    b.methods.getMediaSource.mockImplementation(() => new Promise(() => {}));
    const loading = resolveDownloadMediaSource(options());
    await jest.advanceTimersByTimeAsync(15000);
    expect(await loading).toBeNull();
    expect(a.methods.getMediaSource).toHaveBeenCalledTimes(2);
    expect(b.methods.getMediaSource).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

it("reserves time for the alternate when an original encrypted-source probe consumes its allocation", async () => {
    a.methods.getMediaSource.mockImplementation(() => later(5000, { url: "https://example.com/a.mflac" }));
    b.methods.getMediaSource.mockImplementation(() => later(5000, { url: "https://example.com/b.mp3" }));
    const prepare = jest.fn(async (source: IPlugin.IMediaSourceResult, remaining: number) => {
        if (source.url?.endsWith("mflac")) {
            return withTimeout(new Promise<IPlugin.IMediaSourceResult>(() => {}), remaining);
        }
        return source;
    });
    const loading = resolveDownloadMediaSource({ ...options(), prepare });
    await jest.advanceTimersByTimeAsync(14000);
    expect(await loading).toMatchObject({ identity: { kind: "remembered" } });
    expect(prepare.mock.calls[0][1]).toBe(4000);
    expect(prepare.mock.calls[1][1]).toBe(1000);
});

it("retains keys for the original URL but never copies original keys to an alternate with the same URL", async () => {
    const item = { ...original, url: "https://example.com/shared.mflac", ekey: "old-key" };
    a.methods.getMediaSource.mockResolvedValue({ url: item.url });
    const first = await resolveDownloadMediaSource({ ...options(), musicItem: item });
    expect(first?.source.ekey).toBe("old-key");
    a.methods.getMediaSource.mockResolvedValue(null);
    b.methods.getMediaSource.mockResolvedValue({ url: item.url, ekey: "new-key" });
    const second = await resolveDownloadMediaSource({ ...options(), musicItem: item, prepare: async source => source.ekey === "old-key" ? null : source });
    expect(second?.source.ekey).toBe("new-key");
    expect(second?.identity.kind).toBe("remembered");
});

it("discards a prepared source and never tries another source after cancellation", async () => {
    let active = true;
    a.methods.getMediaSource.mockResolvedValue({ url: "https://example.com/a.mp3" });
    const loading = resolveDownloadMediaSource({ ...options(), isActive: () => active, prepare: source => later(1000, source) });
    await jest.advanceTimersByTimeAsync(0);
    active = false;
    await jest.advanceTimersByTimeAsync(1000);
    expect(await loading).toBeNull();
    expect(b.methods.getMediaSource).not.toHaveBeenCalled();
});
