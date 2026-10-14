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

jest.mock("@/native/storageUri", () => ({
    __esModule: true,
    default: { exists: jest.fn() },
}));

import {
    checkAndroidAudioReadPermission,
    ensureAndroidAudioReadPermission,
    getAndroidAudioReadPermission,
    needsAudioReadPermissionToPlay,
    requiresAudioReadPermission,
    resolveContentUriReadable,
    toggleAndroidAudioReadPermission,
} from "../androidMediaPermission";

const { Linking, PermissionsAndroid } = jest.requireMock("react-native");
const StorageUri = jest.requireMock("@/native/storageUri").default;
const mediaStoreUri = "content://media/external/audio/media/42";
const safUri =
    "content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Fa.mp3";

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

    // 设备回归 2026-10-14（模拟器 API 34，e2e/library.sh）：pm revoke 撤销音频读取
    // 权限后，系统音乐库扫进来的歌读不到，列表把它们都标成“文件不存在”，点了只提示
    // 去重新定位文件，没有地方重新授权。文件其实都在。
    describe("MediaStore URIs without the audio permission", () => {
        it("reports an unreadable MediaStore URI as unknown, not missing", async () => {
            StorageUri.exists.mockResolvedValue(false);
            PermissionsAndroid.check.mockResolvedValue(false);
            await expect(resolveContentUriReadable(mediaStoreUri)).resolves.toBeNull();
        });

        it("treats a revoked-permission error the same way", async () => {
            StorageUri.exists.mockRejectedValue(
                Object.assign(new Error("revoked"), {
                    code: "E_URI_PERMISSION_REVOKED",
                }),
            );
            PermissionsAndroid.check.mockResolvedValue(false);
            await expect(resolveContentUriReadable(mediaStoreUri)).resolves.toBeNull();
        });

        it("still reports a deleted file as missing while permission is granted", async () => {
            StorageUri.exists.mockResolvedValue(false);
            PermissionsAndroid.check.mockResolvedValue(true);
            await expect(resolveContentUriReadable(mediaStoreUri)).resolves.toBe(false);
        });

        it("reports an unreadable SAF URI as missing (it carries its own grant)", async () => {
            StorageUri.exists.mockResolvedValue(false);
            await expect(resolveContentUriReadable(safUri)).resolves.toBe(false);
            expect(PermissionsAndroid.check).not.toHaveBeenCalled();
        });

        it("asks for the permission before playing an unreadable MediaStore URI", async () => {
            StorageUri.exists.mockResolvedValue(false);
            PermissionsAndroid.check.mockResolvedValue(false);
            await expect(needsAudioReadPermissionToPlay(mediaStoreUri)).resolves.toBe(true);
        });

        it("plays a readable MediaStore URI without asking (e.g. the app's own files)", async () => {
            StorageUri.exists.mockResolvedValue(true);
            PermissionsAndroid.check.mockResolvedValue(false);
            await expect(needsAudioReadPermissionToPlay(mediaStoreUri)).resolves.toBe(false);
        });

        it("keeps the existing rules for bare paths, SAF URIs and remote tracks", async () => {
            StorageUri.exists.mockResolvedValue(false);
            await expect(
                needsAudioReadPermissionToPlay("/storage/emulated/0/Music/a.mp3"),
            ).resolves.toBe(true);
            await expect(needsAudioReadPermissionToPlay(safUri)).resolves.toBe(false);
            await expect(needsAudioReadPermissionToPlay(null)).resolves.toBe(false);
        });
    });
});

