import { shouldEvictRecoveredRemoteSourceCacheAfterFailure } from "../sourceRecoveryPolicy";

describe("track player source recovery policy", () => {
    it("evicts recovered remote source cache after parse/container failures", () => {
        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: true,
                error: {
                    code: "mpv-playback-error",
                    nativeMessage: "demuxer failed: unsupported container",
                },
            }),
        ).toBe(true);
    });

    it("keeps local source cache even after parser-looking failures", () => {
        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: true,
                wasRecoveredSource: true,
                error: {
                    message: "container malformed",
                },
            }),
        ).toBe(false);
    });

    it("does not evict unrecovered or transient remote failures", () => {
        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: false,
                error: {
                    message: "unsupported container",
                },
            }),
        ).toBe(false);

        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: true,
                error: {
                    message: "network timeout",
                    code: "io-timeout",
                },
            }),
        ).toBe(false);
    });

    it("evicts recovered remote source cache after stale signed-url HTTP failures", () => {
        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: true,
                error: {
                    nativeMessage: "HttpDataSourceException: response code: 403",
                },
            }),
        ).toBe(true);

        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: true,
                error: {
                    nativeCode: 404,
                },
            }),
        ).toBe(true);
    });

    it("keeps recovered remote source cache after transient HTTP failures", () => {
        expect(
            shouldEvictRecoveredRemoteSourceCacheAfterFailure({
                isLocalSource: false,
                wasRecoveredSource: true,
                error: {
                    nativeMessage: "HttpDataSourceException: response code: 500",
                },
            }),
        ).toBe(false);
    });
});
