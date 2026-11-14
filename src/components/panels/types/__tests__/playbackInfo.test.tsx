import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import PlaybackInfo, { audioInfoText } from "../playbackInfo";

let mockMusic: any;
let mockReady = true;
let mockVideoState: any = { phase: "audio" };
let mockOwner: any = null;
const mockListeners: Record<string, () => void> = {};
const mockRemove = jest.fn();
const mockBackendAccess = jest.fn();
const mockAdapter = {
    getAudioInfo: jest.fn(),
    getRenditionOwner: () => mockOwner,
    addEventListener: jest.fn((name: string, listener: () => void) => {
        mockListeners[name] = listener;
        return { remove: mockRemove };
    }),
};
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        get currentMusic() {
            return mockMusic;
        },
        get isReady() {
            return mockReady;
        },
        get playerAdapter() {
            mockBackendAccess();
            return mockAdapter;
        },
    },
    useCurrentMusic: () => mockMusic,
    useMusicVideoView: () => jest.requireActual("@/core/trackPlayer/musicVideoView").describeMusicVideoView(mockVideoState),
    useMusicQuality: () => "128k",
    useAlternateSourceInUse: () => "Actual source B",
}));
jest.mock("@/core/appConfig", () => ({ useAppConfig: () => undefined }));
jest.mock("@/utils/qualities", () => ({
    getQualityText: () => ({ "128k": "128k-plugin-label" }),
}));
jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: (item: any) => `${item.platform}@${item.id}`,
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({
        t: (key: string) => key,
        getLanguage: () => ({ languageData: {} }),
    }),
}));
jest.mock("@/utils/rpx", () => ({ vh: (value: number) => value * 10 }));
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("../../base/panelHeader", () => () => null);
jest.mock("../../base/panelBase", () => ({
    __esModule: true,
    default: (props: any) => props.renderBody(),
}));
const decoded = {
    mediaId: "A",
    loadGeneration: 1,
    codec: "mp3",
    sampleRate: 16000,
    channelCount: 1,
    bitrate: 16000,
};
let tree: ReactTestRenderer;
function text() {
    return tree.root
        .findAll(node => typeof node.props.children === "string")
        .map(node => node.props.children)
        .join("\n");
}
function refresh() {
    return tree.root.findAll(
        node =>
            node.props.accessibilityLabel === "playbackInfo.refresh" &&
            typeof node.props.onPress === "function",
    )[0];
}
async function mount() {
    await act(async () => {
        tree = create(<PlaybackInfo />);
    });
}
beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockMusic = { id: "a", platform: "Original A", title: "Song A" };
    mockReady = true; mockOwner = null; mockVideoState = { phase: "audio" };
    mockAdapter.getAudioInfo.mockResolvedValue(decoded);
});
afterEach(() => {
    act(() => tree?.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
});

it("separates the plugin label, actual file parameters and alternate source", async () => {
    await mount();
    expect(text()).toContain("128k-plugin-label");
    expect(text()).toContain("16 kb/s");
    expect(text()).toContain("16 kHz");
    expect(text()).toContain("Original A");
    expect(text()).toContain("Actual source B");
    expect(mockAdapter.getAudioInfo).toHaveBeenCalledTimes(1);
    await act(async () => {
        jest.advanceTimersByTime(5000);
    });
    expect(mockAdapter.getAudioInfo).toHaveBeenCalledTimes(1); // No polling.
});

it("refreshes on the existing activation event and unsubscribes on close", async () => {
    await mount();
    mockAdapter.getAudioInfo.mockResolvedValue({
        ...decoded,
        loadGeneration: 2,
        sampleRate: 48000,
    });
    await act(async () => mockListeners.trackChanged());
    expect(text()).toContain("48 kHz");
    act(() => tree.unmount());
    expect(mockRemove).toHaveBeenCalledTimes(3);
});

it("does not show a previous song's late reply after a track change", async () => {
    let resolve!: (value: any) => void;
    mockAdapter.getAudioInfo.mockReturnValueOnce(
        new Promise(done => {
            resolve = done;
        }),
    );
    await mount();
    mockMusic = { ...mockMusic, id: "b", title: "Song B" };
    mockAdapter.getAudioInfo.mockResolvedValue({
        ...decoded,
        mediaId: "B",
        sampleRate: 48000,
    });
    await act(async () => tree.update(<PlaybackInfo />));
    await act(async () => resolve(decoded));
    expect(text()).toContain("Song B");
    expect(text()).toContain("48 kHz");
    expect(text()).not.toContain("16 kHz");
});

it("releases a missing snapshot response at its deadline and allows refresh", async () => {
    mockAdapter.getAudioInfo.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    expect(refresh().props.disabled).toBe(true);
    await act(async () => {
        jest.advanceTimersByTime(2000);
    });
    expect(text()).toContain("playbackInfo.unknown");
    expect(refresh().props.disabled).toBe(false);
    await act(async () => refresh().props.onPress());
    expect(text()).toContain("16 kHz");
});

it("does not initialize a backend just to show an unready player", async () => {
    mockReady = false;
    await mount();
    expect(mockBackendAccess).not.toHaveBeenCalled();
    expect(mockAdapter.getAudioInfo).not.toHaveBeenCalled();
    expect(text()).toContain("playbackInfo.unknown");
});

it("shows unknown fields without inferring the 128k label or leaking native errors", async () => {
    mockAdapter.getAudioInfo.mockRejectedValueOnce(
        new Error("https://private.test/?token=secret"),
    );
    await mount();
    expect(text()).toContain("playbackInfo.unknown");
    expect(text()).not.toMatch(/secret|private.test/);
    expect(text()).not.toContain("128 kb/s");
});

it("formats only safe finite fields and keeps unknown parameters unknown", () => {
    expect(audioInfoText(null, "unknown")).toEqual({
        codec: "unknown",
        sampleRate: "unknown",
        channelCount: "unknown",
        bitrate: "unknown",
    });
    expect(
        audioInfoText(
            {
                ...decoded,
                codec: "https://user:pass@test/private",
                sampleRate: NaN,
                channelCount: 1.5,
                bitrate: Infinity,
            },
            "unknown",
        ),
    ).toEqual({
        codec: "unknown",
        sampleRate: "unknown",
        channelCount: "unknown",
        bitrate: "unknown",
    });
    expect(
        audioInfoText(
            { ...decoded, sampleRate: 44100, bitrate: 192123 },
            "unknown",
        ),
    ).toMatchObject({ sampleRate: "44.1 kHz", bitrate: "192.1 kb/s" });
});

it("shows MV provider and video quality separately from actual decoded audio", async () => {
    mockOwner = { kind: "mv", mediaId: "A", loadGeneration: 2 };
    mockVideoState = { phase: "video", owner: mockOwner, video: { title: "The MV", providerName: "Video provider", qualityId: "720p", qualities: [{ id: "720p", label: "HD 720p" }] } };
    mockAdapter.getAudioInfo.mockResolvedValue({ ...decoded, loadGeneration: 2, codec: "aac", sampleRate: 48000 });
    await mount();
    expect(text()).toContain("The MV · MV"); expect(text()).toContain("Video provider");
    expect(text()).toContain("HD 720p"); expect(text()).toContain("aac"); expect(text()).toContain("48 kHz");
    expect(text()).not.toContain("128k-plugin-label"); expect(text()).not.toContain("Actual source B");
});

it("rejects an old same-song rendition reply even before a refresh event arrives", async () => {
    mockOwner = { kind: "audio", mediaId: "A", loadGeneration: 1 };
    let resolve!: (value: any) => void;
    mockAdapter.getAudioInfo.mockReturnValueOnce(new Promise(done => {
        resolve = done;
    })); await mount();
    mockOwner = { kind: "mv", mediaId: "A", loadGeneration: 2 };
    await act(async () => resolve(decoded));
    expect(text()).not.toContain("16 kHz");
    mockAdapter.getAudioInfo.mockResolvedValue({ ...decoded, loadGeneration: 2, sampleRate: 48000 });
    await act(async () => mockListeners.renditionChanged());
    expect(text()).toContain("48 kHz");
});
