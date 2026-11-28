import { TrackPlayerEvents } from "@/constants/trackPlayerConst";

const mockAdapterListeners = new Map<string, Set<(payload?: any) => any>>();
const mockPlayerListeners = new Map<string, Set<(payload?: any) => any>>();
const mockPluginCallback = jest.fn();
const mockSeekTo = jest.fn(async (_pos: number) => undefined);
const mockStopByExternalRequest = jest.fn(async () => undefined);
const mockPauseByExternalRequest = jest.fn(async (_reason: string) => undefined);
const mockPlayCurrentMusic = jest.fn(async () => undefined);

const mockTrackPlayer: Record<string, any> = {
    currentMusic: { id: "a", platform: "test-plugin", title: "Song A" },
    audioTimelineAvailable: false,
    on: jest.fn((event: string, cb: (payload?: any) => void) => {
        if (!mockPlayerListeners.has(event)) {
            mockPlayerListeners.set(event, new Set());
        }
        mockPlayerListeners.get(event)!.add(cb);
    }),
    seekTo: (pos: number) => mockSeekTo(pos),
    stopByExternalRequest: () => mockStopByExternalRequest(),
    pauseByExternalRequest: (reason: string) =>
        mockPauseByExternalRequest(reason),
    handleSystemInterruptionBegan: jest.fn(),
    handleSystemInterruptionEnded: jest.fn(async () => undefined),
    notePlayRequestedFromOutside: jest.fn(),
    skipToNext: jest.fn(async () => undefined),
    skipToPrevious: jest.fn(async () => undefined),
    playerAdapter: {
        addEventListener: jest.fn(
            (event: string, cb: (payload?: any) => any) => {
                if (!mockAdapterListeners.has(event)) {
                    mockAdapterListeners.set(event, new Set());
                }
                mockAdapterListeners.get(event)!.add(cb);
                return { remove: jest.fn() };
            },
        ),
    },
};

jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: mockTrackPlayer,
}));
jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getByMedia: jest.fn(() => ({
            instance: { onPlaybackStateChange: mockPluginCallback },
        })),
    },
}));
jest.mock("../userPlayAction", () => ({
    __esModule: true,
    playCurrentMusic: () => mockPlayCurrentMusic(),
}));
jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
    trace: jest.fn(),
}));

const observer = require("../playbackServiceObserver").default;

function emitAdapterEvent(event: string, payload?: any) {
    for (const cb of mockAdapterListeners.get(event) ?? []) {
        cb(payload);
    }
}

describe("playbackServiceObserver", () => {
    beforeAll(() => {
        observer.setupPlaybackObserver();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockTrackPlayer.audioTimelineAvailable = true;
    });

    it("ignores playback state and progress updates while MV owns the timeline", () => {
        mockTrackPlayer.audioTimelineAvailable = false;

        emitAdapterEvent("playbackStateChanged", "playing");
        emitAdapterEvent("progress", { position: 9, duration: 24 });
        expect(mockPluginCallback).not.toHaveBeenCalled();

        mockTrackPlayer.audioTimelineAvailable = true;
        emitAdapterEvent("playbackStateChanged", "playing");
        emitAdapterEvent("progress", { position: 37.25, duration: 200 });
        expect(mockPluginCallback).toHaveBeenCalledTimes(2);
        expect(mockPluginCallback).toHaveBeenNthCalledWith(1, {
            musicItem: mockTrackPlayer.currentMusic,
            event: "play",
        });
        expect(mockPluginCallback).toHaveBeenNthCalledWith(2, {
            musicItem: mockTrackPlayer.currentMusic,
            event: "progress",
            data: { currentTime: 37.25, duration: 200 },
        });
    });

    it("routes remoteStop and remoteSeek through TrackPlayer guards", async () => {
        emitAdapterEvent("remoteStop");
        emitAdapterEvent("remoteSeek", { position: 42.5 });
        await Promise.resolve();

        expect(mockStopByExternalRequest).toHaveBeenCalledTimes(1);
        expect(mockSeekTo).toHaveBeenCalledWith(42.5);
        expect(
            mockPlayerListeners.has(TrackPlayerEvents.CurrentMusicChanged),
        ).toBe(true);
    });
});
