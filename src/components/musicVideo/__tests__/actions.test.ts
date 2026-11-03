import {
    watchMusicVideo,
    cancelPendingVideoAction,
    changeMusicVideoQuality,
} from "../actions";

let mockRevision = 1;
let mockMusic: any;
let mockEnabled = true;
let mockApproval = false;
let mockDialog: any;
let mockNextDialog = 0;
const mockNetwork = jest.fn();
const mockCancel = jest.fn();
const mockPreflightResults: any[] = [];
const mockWatch = jest.fn(
    async (_candidate: any, _quality: any, options: any) => {
        const preparation = await options.preflight(
            new AbortController().signal,
        );
        mockPreflightResults.push(preparation);
        return { status: preparation ? "playing" : "cancelled" };
    },
);
const mockQuality = jest.fn();
const mockToast = jest.fn();
const mockHide = jest.fn((id: number) => {
    if (mockDialog.id === id) mockDialog = { ...mockDialog, name: null };
});
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        get currentMusic() {
            return mockMusic;
        },
        get playbackIntentRevision() {
            return mockRevision;
        },
        get videoMobileApproved() {
            return mockApproval;
        },
        watchMusicVideo: (...args: any[]) => (mockWatch as any)(...args),
        changeVideoQuality: (...args: any[]) => mockQuality(...args),
        cancelVideoRequest: () => mockCancel(),
    },
}));
jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: { getConfig: () => mockEnabled },
}));
jest.mock("@/utils/network", () => ({
    __esModule: true,
    default: { getFreshState: () => mockNetwork() },
}));
jest.mock("@/core/i18n", () => ({
    __esModule: true,
    default: { t: (key: string) => key },
}));
jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: { warn: (...args: any[]) => mockToast(...args) },
}));
jest.mock("@/components/dialogs/useDialog", () => ({
    showDialog: (name: string, payload: any) => {
        mockDialog = { id: ++mockNextDialog, name, payload };
    },
    getCurrentDialog: () => mockDialog,
    hideDialog: (id: number) => mockHide(id),
}));
const candidate = {
    id: "v",
    title: "Video",
    originalSongKey: "p@a",
    providerKey: "p",
    providerName: "Provider",
};
const wifi = {
    isConnected: true,
    isInternetReachable: true,
    type: "wifi",
    details: { isConnectionExpensive: false },
};
const cellular = { ...wifi, type: "cellular" };
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
    jest.clearAllMocks();
    mockRevision = 1;
    mockEnabled = true;
    mockApproval = false;
    mockMusic = { id: "a", platform: "p" };
    mockDialog = { id: 0, name: null };
    mockPreflightResults.length = 0;
    mockNetwork.mockResolvedValue(wifi);
    mockQuality.mockImplementation(
        async (_quality, _restart, _approved, preflight) => {
            const result = await preflight(new AbortController().signal);
            return { status: result ? "playing" : "cancelled" };
        },
    );
});
afterEach(() => cancelPendingVideoAction());

test("invokes the owning controller before waiting for a fresh network response", async () => {
    let resolve!: (value: any) => void;
    mockNetwork.mockReturnValueOnce(
        new Promise(done => {
            resolve = done;
        }),
    );
    const pending = watchMusicVideo(candidate);
    expect(mockWatch).toHaveBeenCalledTimes(1);
    expect(mockPreflightResults).toEqual([]);
    resolve(wifi);
    await pending;
    expect(mockPreflightResults[0]).toEqual({
        mobileApproved: false,
        claimPlayback: true,
    });
});

test("a pause after the tap suppresses a later playback claim", async () => {
    let resolve!: (value: any) => void;
    mockNetwork.mockReturnValueOnce(
        new Promise(done => {
            resolve = done;
        }),
    );
    const pending = watchMusicVideo(candidate);
    mockRevision++;
    resolve(wifi);
    await pending;
    expect(mockPreflightResults[0].claimPlayback).toBe(false);
});

test("denies mobile playback when the existing total switch is disabled", async () => {
    mockEnabled = false;
    mockNetwork.mockResolvedValue(cellular);
    await watchMusicVideo(candidate);
    expect(mockPreflightResults).toEqual([null]);
    expect(mockDialog.name).toBeNull();
    expect(mockToast).toHaveBeenCalledWith("musicVideo.mobileDisabled");
});

test.each(["onCancel", "onDismiss"])(
    "%s does not authorize mobile playback",
    async event => {
        mockNetwork.mockResolvedValue(cellular);
        const pending = watchMusicVideo(candidate);
        await flush();
        mockDialog.payload[event]();
        await pending;
        expect(mockPreflightResults).toEqual([null]);
    },
);

test("mobile confirmation authorizes this session while preserving a pause made inside the dialog", async () => {
    mockNetwork.mockResolvedValue(cellular);
    const pending = watchMusicVideo(candidate);
    await flush();
    mockRevision++;
    mockDialog.payload.onOk();
    await pending;
    expect(mockPreflightResults[0]).toEqual({
        mobileApproved: true,
        claimPlayback: false,
    });
});

test("cancelling a request dismisses only its own dialog, not a newer unrelated one", async () => {
    mockNetwork.mockResolvedValue(cellular);
    const pending = watchMusicVideo(candidate);
    await flush();
    const oldId = mockDialog.id;
    mockDialog = { id: ++mockNextDialog, name: "OtherDialog" };
    cancelPendingVideoAction();
    await pending;
    expect(mockHide).toHaveBeenCalledWith(oldId);
    expect(mockDialog.name).toBe("OtherDialog");
    expect(mockPreflightResults).toEqual([null]);
});

test("a late network reply after leaving the page cannot start its selection", async () => {
    let resolve!: (value: any) => void;
    mockNetwork.mockReturnValueOnce(
        new Promise(done => {
            resolve = done;
        }),
    );
    const pending = watchMusicVideo(candidate);
    cancelPendingVideoAction();
    resolve(wifi);
    await pending;
    expect(mockPreflightResults).toEqual([null]);
});

test("changing the song while consent is open rejects the old approval", async () => {
    mockNetwork.mockResolvedValue(cellular);
    const pending = watchMusicVideo(candidate);
    await flush();
    mockMusic = { id: "b", platform: "p" };
    mockDialog.payload.onOk();
    await pending;
    expect(mockPreflightResults).toEqual([null]);
});

test("a saved mobile approval still requires a fresh connected network", async () => {
    mockApproval = true;
    mockNetwork.mockResolvedValue({ ...cellular, isConnected: false });
    await watchMusicVideo(candidate);
    expect(mockDialog.name).toBeNull();
    expect(mockPreflightResults).toEqual([null]);
});

test("different-cut quality requires a separate confirmation before requesting a restart", async () => {
    mockQuality.mockImplementationOnce(async () => ({
        status: "restart-confirmation",
    }));
    const pending = changeMusicVideoQuality("1080p");
    await flush();
    expect(mockQuality).toHaveBeenCalledTimes(1);
    expect(mockQuality.mock.calls[0][1]).toBe(false);
    mockDialog.payload.onOk();
    await pending;
    expect(mockQuality.mock.calls[1][1]).toBe(true);
});

test.each(["unknown", "none"])("%s network cannot claim or load an MV even when connected is true", async type => {
    mockNetwork.mockResolvedValue({ ...wifi, type });
    await watchMusicVideo(candidate);
    expect(mockPreflightResults).toEqual([null]); expect(mockDialog.name).toBeNull();
});

test("a previous session approval does not override a newly disabled mobile total switch", async () => {
    mockApproval = true; mockEnabled = false; mockNetwork.mockResolvedValue(cellular);
    await watchMusicVideo(candidate); expect(mockPreflightResults).toEqual([null]);
    expect(mockToast).toHaveBeenCalledWith("musicVideo.mobileDisabled");
});
