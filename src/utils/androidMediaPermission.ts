import { PermissionsAndroid, Platform } from "react-native";

export function getAndroidAudioReadPermission(apiLevel: number) {
    return apiLevel >= 33
        ? "android.permission.READ_MEDIA_AUDIO"
        : "android.permission.READ_EXTERNAL_STORAGE";
}

/**
 * 播放这个本地路径是否需要先拿到音频读取权限。
 *
 * `content://` 是用户经 SAF/MediaStore 主动授予的 URI，本身带 grant，不需要
 * 再要权限；裸文件路径（`file://` 或绝对路径）读共享存储则必须有
 * READ_MEDIA_AUDIO（API 33+）/ READ_EXTERNAL_STORAGE。
 */
export function requiresAudioReadPermission(localPath: string | null | undefined) {
    if (!localPath) {
        return false;
    }
    return !localPath.startsWith("content://");
}

export async function ensureAndroidAudioReadPermission() {
    if (Platform.OS !== "android") {
        return true;
    }
    const permission = getAndroidAudioReadPermission(
        Number(Platform.Version),
    ) as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];
    if (await PermissionsAndroid.check(permission)) {
        return true;
    }
    return (
        (await PermissionsAndroid.request(permission)) ===
        PermissionsAndroid.RESULTS.GRANTED
    );
}

