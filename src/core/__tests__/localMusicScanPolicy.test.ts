import {
    defaultLocalMusicScanPolicy,
    getLocalMusicScanFilterReason,
    normalizeLocalMusicScanPolicy,
} from "../localMusicScanPolicy";

const candidate = (partial: Record<string, unknown> = {}) => ({
    musicPath: "/music/track.mp3",
    ...partial,
});

describe("local music scan policy", () => {
    it("preserves the legacy default short-audio and system-sound behavior", () => {
        expect(
            getLocalMusicScanFilterReason(
                candidate(),
                { duration: "7999" },
                undefined,
            ),
        ).toBe("duration");
        expect(
            getLocalMusicScanFilterReason(
                candidate(),
                { duration: "8000" },
                undefined,
            ),
        ).toBeNull();
        expect(
            getLocalMusicScanFilterReason(
                candidate({ displayName: "alarm-tone.mp3" }),
                { duration: "12000" },
                undefined,
            ),
        ).toBe("likely-system-sound");
        expect(
            getLocalMusicScanFilterReason(
                candidate({ displayName: "notification.mp3" }),
                { duration: "20000" },
                undefined,
            ),
        ).toBeNull();
    });

    it("filters a known undersized candidate before metadata is available", () => {
        const policy = {
            ...defaultLocalMusicScanPolicy,
            minFileSizeBytes: 1024,
        };

        expect(
            getLocalMusicScanFilterReason(
                candidate({ size: 512 }),
                null,
                policy,
            ),
        ).toBe("file-size");
        expect(
            getLocalMusicScanFilterReason(candidate(), null, policy),
        ).toBeNull();
    });

    it("allows a policy to disable duration and system-sound filtering", () => {
        const policy = {
            minDurationSeconds: 0,
            minFileSizeBytes: 0,
            filterLikelySystemSounds: false,
        };

        expect(
            getLocalMusicScanFilterReason(
                candidate({ displayName: "alarm.mp3" }),
                { duration: 1000 },
                policy,
            ),
        ).toBeNull();
    });

    it("normalizes malformed persisted values without broadening filtering", () => {
        expect(
            normalizeLocalMusicScanPolicy({
                minDurationSeconds: 9999,
                minFileSizeBytes: 123,
                filterLikelySystemSounds: "true",
            }),
        ).toEqual(defaultLocalMusicScanPolicy);

        expect(
            normalizeLocalMusicScanPolicy({
                minDurationSeconds: null,
                minFileSizeBytes: false,
                filterLikelySystemSounds: 1,
            }),
        ).toEqual(defaultLocalMusicScanPolicy);
    });
});
