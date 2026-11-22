const mockModule = {
    initialize: jest.fn(async (): Promise<void> => undefined),
    loadAndPlay: jest.fn(async (): Promise<number | null> => 37.5),
    stop: jest.fn(async () => undefined),
    setVolume: jest.fn(async (_volume: number) => undefined),
};
jest.mock("react-native", () => ({
    NativeModules: { MpvPlayer: mockModule }, Platform: { OS: "android" },
    NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn(() => ({ remove: jest.fn() })) })),
}));
const native = require("../nativeMpvPlayer").default as typeof import("../nativeMpvPlayer").default;
const payload = { url: "https://example.test/video.mp4", mediaId: "a", loadGeneration: 2, prepareToken: 0, queueRevision: 1 };

beforeEach(async () => {
    mockModule.initialize.mockReset().mockResolvedValue(undefined);
    mockModule.loadAndPlay.mockReset().mockResolvedValue(37.5);
    await native.initialize({ userAgent: "host", progressIntervalMs: 250 });
    mockModule.initialize.mockClear();
});

test("a retired network engine is recreated once with the host initialization options", async () => {
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_VIDEO_NETWORK_RETIRED" });
    await expect(native.loadAndPlay(payload)).resolves.toBe(37.5);
    expect(mockModule.initialize).toHaveBeenCalledTimes(1);
    expect(mockModule.initialize).toHaveBeenCalledWith({ userAgent: "host", progressIntervalMs: 250 });
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(2);
    expect(mockModule.loadAndPlay.mock.calls[1]).toEqual([{ ...payload, retryAfterVideoNetworkRetirement: true }]);
});

test.each(["E_NOT_INIT", "E_RENDITION_REJECTED", "E_VIDEO_NETWORK_BLOCKED", "E_LOAD"])("%s cannot trigger an implicit initialization or policy retry", async code => {
    mockModule.loadAndPlay.mockRejectedValueOnce({ code });
    await expect(native.loadAndPlay(payload)).rejects.toMatchObject({ code });
    expect(mockModule.initialize).not.toHaveBeenCalled();
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(1);
});

test("an initialization failure does not replay the source", async () => {
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_VIDEO_NETWORK_RETIRED" });
    mockModule.initialize.mockRejectedValueOnce(new Error("unavailable"));
    await expect(native.loadAndPlay(payload)).rejects.toThrow("unavailable");
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(1);
});

test("a second retirement cannot form an unbounded restart loop", async () => {
    mockModule.loadAndPlay.mockRejectedValue({ code: "E_VIDEO_NETWORK_RETIRED" });
    await expect(native.loadAndPlay(payload)).rejects.toMatchObject({ code: "E_VIDEO_NETWORK_RETIRED" });
    expect(mockModule.initialize).toHaveBeenCalledTimes(1);
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(2);
});

test("a newer source cannot be overwritten by an older retirement retry", async () => {
    let release!: () => void;
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_VIDEO_NETWORK_RETIRED" });
    mockModule.initialize.mockImplementationOnce(() => new Promise<void>(resolve => {
        release = resolve;
    }));
    const old = native.loadAndPlay(payload).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    await native.loadAndPlay({ ...payload, mediaId: "b", loadGeneration: 3 });
    release();
    await expect(old).resolves.toMatchObject({ code: "E_RENDITION_SUPERSEDED" });
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(2);
});

test("stop invalidates a retirement retry before it can load a source", async () => {
    let release!: () => void;
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_VIDEO_NETWORK_RETIRED" });
    mockModule.initialize.mockImplementationOnce(() => new Promise<void>(resolve => {
        release = resolve;
    }));
    const old = native.loadAndPlay(payload).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    await native.stop(); release();
    await expect(old).resolves.toMatchObject({ code: "E_RENDITION_SUPERSEDED" });
    expect(mockModule.loadAndPlay).toHaveBeenCalledTimes(1);
});

test("a network engine restart preserves the last effective mute or duck volume", async () => {
    await native.setVolume(0.2); mockModule.setVolume.mockClear();
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_VIDEO_NETWORK_RETIRED" });
    await native.loadAndPlay(payload);
    expect(mockModule.setVolume).toHaveBeenCalledWith(0.2);
});

test("a failed terminal stop recreates the engine once without imposing an MV network policy on audio", async () => {
    mockModule.loadAndPlay.mockRejectedValueOnce({ code: "E_MPV_ENGINE_RETIRED" });
    await expect(native.loadAndPlay(payload)).resolves.toBe(37.5);
    expect(mockModule.initialize).toHaveBeenCalledTimes(1);
    expect(mockModule.loadAndPlay.mock.calls[1]).toEqual([{ ...payload, retryAfterVideoNetworkRetirement: false }]);
});
