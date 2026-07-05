import { resolvePluginLocalMediaSource } from "../localMediaSourcePolicy";

const localPluginPlatform = "local";

describe("local media source policy", () => {
    it("uses a remote localPath as an already resolved playable source", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: "netease",
                localPluginPlatform,
                localPath: "https://cdn.example.com/song.mp3",
                localPathInMediaExtra: "https://cdn.example.com/song.mp3",
            }),
        ).toEqual({
            type: "remote",
            url: "https://cdn.example.com/song.mp3",
        });
    });

    it("lets imported remote local-plugin entries play without plugin parsing", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: localPluginPlatform,
                localPluginPlatform,
                url: "https://cdn.example.com/imported.flac",
            }),
        ).toEqual({
            type: "remote",
            url: "https://cdn.example.com/imported.flac",
        });
    });

    it("short-circuits existing local files and normalizes the stored localPath", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: "local",
                localPluginPlatform,
                localPath: "file:///sdcard/Music/song.mp3",
                localPathInMediaExtra: "file:///sdcard/Music/song.mp3",
                normalizedLocalPath: "/sdcard/Music/song.mp3",
                normalizedLocalPathExists: true,
            }),
        ).toEqual({
            type: "local",
            localPath: "/sdcard/Music/song.mp3",
            url: "file:///sdcard/Music/song.mp3",
            patchLocalPath: "/sdcard/Music/song.mp3",
        });
    });

    it("accepts content uri local paths without filesystem existence checks", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: localPluginPlatform,
                localPluginPlatform,
                localPath: "content://media/external/audio/media/42",
                localPathInMediaExtra: "content://media/external/audio/media/42",
                normalizedLocalPath: "content://media/external/audio/media/42",
            }),
        ).toEqual({
            type: "local",
            localPath: "content://media/external/audio/media/42",
            url: "content://media/external/audio/media/42",
            patchLocalPath: undefined,
        });
    });

    it("clears a stale injected localPath before online source parsing continues", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: "netease",
                localPluginPlatform,
                localPath: "/sdcard/Music/missing.mp3",
                localPathInMediaExtra: "/sdcard/Music/missing.mp3",
                normalizedLocalPath: "/sdcard/Music/missing.mp3",
                normalizedLocalPathExists: false,
            }),
        ).toEqual({
            type: "clear-stale-local-path",
        });
    });

    it("reports missing local music instead of falling through to plugin parsing", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: localPluginPlatform,
                localPluginPlatform,
                localPath: "/sdcard/Music/missing.mp3",
                normalizedLocalPath: "/sdcard/Music/missing.mp3",
                normalizedLocalPathExists: false,
            }),
        ).toEqual({
            type: "missing-local",
        });
    });

    it("continues to normal plugin parsing for non-local items without local paths", () => {
        expect(
            resolvePluginLocalMediaSource({
                platform: "netease",
                localPluginPlatform,
                url: undefined,
            }),
        ).toEqual({
            type: "continue",
        });
    });
});
