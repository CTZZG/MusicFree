import {
    callGetMediaSourceWithLegacyFallback,
    normalizeMediaSourceResultWithFailure,
} from "../mediaSourceResolution";
import { MediaSourceResolutionError } from "../mediaSourceFailure";

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    default: jest.fn(),
}));

const musicItem: IMusic.IMusicItemBase = {
    id: "track-1",
    platform: "test-plugin",
    title: "Track",
    artist: "Artist",
    duration: 180,
};
const context = {
    mediaKey: "test-plugin::track-1",
    pluginName: "test-plugin",
    quality: "flac",
};

describe("plugin media source resolution", () => {
    it("preserves a normalized failure when the legacy fallback returns null", async () => {
        const getMediaSource = jest
            .fn()
            .mockResolvedValueOnce({
                failure: { code: "network-error", retryable: false },
            })
            .mockResolvedValueOnce(null);

        await expect(
            callGetMediaSourceWithLegacyFallback(
                getMediaSource,
                musicItem,
                "flac",
                context,
            ),
        ).resolves.toEqual({
            failure: { code: "network-error", retryable: false },
        });
        expect(getMediaSource).toHaveBeenNthCalledWith(1, musicItem, "flac");
        expect(getMediaSource).toHaveBeenNthCalledWith(2, musicItem, "super");
    });

    it("keeps the more actionable failure across both attempts", async () => {
        const getMediaSource = jest
            .fn()
            .mockResolvedValueOnce({
                failure: { code: "encrypted-unsupported" },
            })
            .mockRejectedValueOnce(Object.assign(new Error("timeout"), {
                code: "ETIMEDOUT",
            }));

        await expect(
            callGetMediaSourceWithLegacyFallback(
                getMediaSource,
                musicItem,
                "flac",
                context,
            ),
        ).resolves.toEqual({
            failure: {
                code: "encrypted-unsupported",
                retryable: false,
            },
        });
    });

    it("classifies a thrown normalized attempt when legacy returns no source", async () => {
        const getMediaSource = jest
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("timed out"), {
                code: "ETIMEDOUT",
            }))
            .mockResolvedValueOnce(null);

        await expect(
            callGetMediaSourceWithLegacyFallback(
                getMediaSource,
                musicItem,
                "flac",
                context,
            ),
        ).resolves.toEqual({
            failure: { code: "network-error", retryable: true },
        });
    });

    it("preserves the legacy NOT RETRY sentinel as non-retryable", async () => {
        const getMediaSource = jest
            .fn()
            .mockRejectedValue(new Error("NOT RETRY"));

        await expect(
            callGetMediaSourceWithLegacyFallback(
                getMediaSource,
                musicItem,
                "flac",
                context,
                false,
            ),
        ).resolves.toEqual({
            failure: { code: "unavailable", retryable: false },
        });
        expect(getMediaSource).toHaveBeenCalledTimes(1);
        expect(getMediaSource).toHaveBeenCalledWith(musicItem, "flac");
    });

    it("uses a playable legacy result over a normalized failure", async () => {
        const legacyResult = {
            url: "https://media.example.com/song.flac",
        };
        const getMediaSource = jest
            .fn()
            .mockResolvedValueOnce({
                failure: { code: "unavailable" },
            })
            .mockResolvedValueOnce(legacyResult);

        await expect(
            callGetMediaSourceWithLegacyFallback(
                getMediaSource,
                musicItem,
                "flac",
                context,
            ),
        ).resolves.toBe(legacyResult);
    });

    it("turns shortcut normalization errors into structured failures", () => {
        const normalize = jest.fn(() => {
            throw new MediaSourceResolutionError(
                "policy-blocked",
                "blocked",
            );
        });

        expect(normalizeMediaSourceResultWithFailure(
            { url: "http://media.example.com/song.mp3" },
            normalize,
            context,
        )).toEqual({
            failure: {
                code: "policy-blocked",
                retryable: false,
            },
        });
    });
});
