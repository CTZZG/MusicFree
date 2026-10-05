jest.mock("react-native", () => ({
    Linking: { openSettings: jest.fn() },
    PermissionsAndroid: {
        PERMISSIONS: {
            READ_EXTERNAL_STORAGE: "android.permission.READ_EXTERNAL_STORAGE",
            READ_MEDIA_AUDIO: "android.permission.READ_MEDIA_AUDIO",
        },
        RESULTS: { GRANTED: "granted", NEVER_ASK_AGAIN: "never_ask_again" },
        check: jest.fn(),
        request: jest.fn(),
    },
    Platform: { OS: "android", Version: 33 },
}));

import {
    checkAndroidAudioReadPermission,
    ensureAndroidAudioReadPermission,
    getAndroidAudioReadPermission,
    requiresAudioReadPermission,
    toggleAndroidAudioReadPermission,
} from "../androidMediaPermission";

const { Linking, PermissionsAndroid } = jest.requireMock("react-native");

describe("androidMediaPermission", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each([
        [24, "android.permission.READ_EXTERNAL_STORAGE"],
        [32, "android.permission.READ_EXTERNAL_STORAGE"],
        [33, "android.permission.READ_MEDIA_AUDIO"],
        [36, "android.permission.READ_MEDIA_AUDIO"],
    ])("selects the API %i permission", (apiLevel, permission) => {
        expect(getAndroidAudioReadPermission(apiLevel)).toBe(permission);
    });

    it("does not prompt when permission is already granted", async () => {
        PermissionsAndroid.check.mockResolvedValue(true);
        await expect(ensureAndroidAudioReadPermission()).resolves.toBe(true);
        expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    });

    it("returns false when a feature-level request is denied", async () => {
        PermissionsAndroid.check.mockResolvedValue(false);
        PermissionsAndroid.request.mockResolvedValue("denied");
        await expect(ensureAndroidAudioReadPermission()).resolves.toBe(false);
    });

    // 权限页的开关以前跳到「所有文件访问」，但应用从 0.7.3 起就不声明
    // MANAGE_EXTERNAL_STORAGE 了，系统页上的开关永远是灰的。现在只管真正用到的
    // 音频读取权限。
    describe("permissions page toggle", () => {
        it("checks the API-level audio permission", async () => {
            PermissionsAndroid.check.mockResolvedValue(true);
            await expect(checkAndroidAudioReadPermission()).resolves.toBe(true);
            expect(PermissionsAndroid.check).toHaveBeenCalledWith(
                "android.permission.READ_MEDIA_AUDIO",
            );
        });

        it("asks the system when the permission is missing", async () => {
            PermissionsAndroid.check.mockResolvedValue(false);
            PermissionsAndroid.request.mockResolvedValue("granted");
            await expect(toggleAndroidAudioReadPermission()).resolves.toBe(true);
            expect(PermissionsAndroid.request).toHaveBeenCalledWith(
                "android.permission.READ_MEDIA_AUDIO",
            );
            expect(Linking.openSettings).not.toHaveBeenCalled();
        });

        it("opens app settings when Android will not ask again", async () => {
            PermissionsAndroid.check.mockResolvedValue(false);
            PermissionsAndroid.request.mockResolvedValue("never_ask_again");
            await expect(toggleAndroidAudioReadPermission()).resolves.toBe(false);
            expect(Linking.openSettings).toHaveBeenCalledTimes(1);
        });

        it("stays put after a plain denial", async () => {
            PermissionsAndroid.check.mockResolvedValue(false);
            PermissionsAndroid.request.mockResolvedValue("denied");
            await expect(toggleAndroidAudioReadPermission()).resolves.toBe(false);
            expect(Linking.openSettings).not.toHaveBeenCalled();
        });

        it("opens app settings to turn an existing grant off", async () => {
            PermissionsAndroid.check.mockResolvedValue(true);
            await expect(toggleAndroidAudioReadPermission()).resolves.toBe(true);
            expect(PermissionsAndroid.request).not.toHaveBeenCalled();
            expect(Linking.openSettings).toHaveBeenCalledTimes(1);
        });
    });

    // Device regression 2026-07-26 (API 36 Honor, targetSdk 30 -> 36 upgrade):
    // READ_MEDIA_AUDIO is a NEW runtime permission and is not inherited from the
    // old build's READ_EXTERNAL_STORAGE. Only the local-music scan button asked
    // for it, so every local track failed with a bare Media3 "Source error".
    // TrackPlayer.play now gates on this predicate before resolving a source.
    describe("requiresAudioReadPermission", () => {
        it.each([
            ["/storage/emulated/0/Music/a.dsf", true],
            ["file:///storage/emulated/0/Music/a.flac", true],
            ["/data/user/0/fun.upup.musicfree/files/download/a.mp3", true],
        ])("requires permission for bare path %s", (path, expected) => {
            expect(requiresAudioReadPermission(path)).toBe(expected);
        });

        it("does not require permission for a SAF/MediaStore content URI", () => {
            // content:// already carries its own grant.
            expect(
                requiresAudioReadPermission("content://media/external/audio/media/42"),
            ).toBe(false);
        });

        it.each([[null], [undefined], [""]])(
            "treats %p as a remote track needing no audio permission",
            value => {
                expect(requiresAudioReadPermission(value as any)).toBe(false);
            },
        );
    });
});

