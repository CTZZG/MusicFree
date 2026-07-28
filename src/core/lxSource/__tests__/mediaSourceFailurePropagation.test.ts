jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: () => ({
        getString: jest.fn(() => undefined),
        set: jest.fn(),
    }),
}));

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: jest.fn(() => false),
    },
}));

jest.mock("react-native-fs", () => ({
    readFile: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
    readAsStringAsync: jest.fn(),
}));

jest.mock("@/utils/restrictedHttpClient", () => ({
    createRestrictedHttpClient: jest.fn(() => ({
        get: jest.fn(),
    })),
}));

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
    trace: jest.fn(),
}));

jest.mock("react-native-reanimated", () => ({
    Easing: {
        exp: jest.fn(),
        out: jest.fn((value: unknown) => value),
    },
}));

jest.mock("../runtime", () => ({
    createLxSourceRuntime: jest.fn(),
    requestLxMusicUrl: jest.fn(),
    setLxAllowInsecureHttp: jest.fn(),
}));

import LxSource from "../index";
import type { ILxSourceItem } from "../types";

function source(id: string): ILxSourceItem {
    return {
        id,
        enabled: true,
        script: "",
        metadata: { name: id },
        installedAt: 1,
        updatedAt: 1,
    };
}

describe("LX media-source failure propagation", () => {
    const musicItem = {
        id: "track-1",
        platform: "qq",
        title: "Track",
        artist: "Artist",
    } as IMusic.IMusicItemBase;

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("keeps the most actionable failure across enabled sources", async () => {
        const manager = LxSource as any;
        jest.spyOn(manager, "getSources").mockReturnValue([
            source("network"),
            source("encrypted"),
        ]);
        jest.spyOn(manager, "requestMediaSourceFromItem")
            .mockResolvedValueOnce({
                failure: { code: "network-error", retryable: true },
            })
            .mockResolvedValueOnce({
                failure: {
                    code: "encrypted-unsupported",
                    retryable: false,
                },
            });

        await expect(
            manager.getMediaSource(musicItem, "flac"),
        ).resolves.toEqual({
            failure: {
                code: "encrypted-unsupported",
                retryable: false,
            },
        });
    });

    it("still lets a later playable source win over an earlier failure", async () => {
        const manager = LxSource as any;
        jest.spyOn(manager, "getSources").mockReturnValue([
            source("failed"),
            source("playable"),
        ]);
        jest.spyOn(manager, "requestMediaSourceFromItem")
            .mockResolvedValueOnce({
                failure: { code: "policy-blocked", retryable: false },
            })
            .mockResolvedValueOnce({
                url: "https://media.example/track.flac",
                quality: "flac",
            });

        await expect(
            manager.getMediaSource(musicItem, "flac"),
        ).resolves.toMatchObject({
            url: "https://media.example/track.flac",
            quality: "flac",
        });
    });
});
