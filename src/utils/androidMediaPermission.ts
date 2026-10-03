import { Linking, PermissionsAndroid, Platform } from "react-native";

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

function getRuntimeAudioReadPermission() {
    return getAndroidAudioReadPermission(
        Number(Platform.Version),
    ) as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];
}

export async function checkAndroidAudioReadPermission() {
    if (Platform.OS !== "android") {
        return true;
    }
    return PermissionsAndroid.check(getRuntimeAudioReadPermission());
}

export async function ensureAndroidAudioReadPermission() {
    if (Platform.OS !== "android") {
        return true;
    }
    const permission = getRuntimeAudioReadPermission();
    if (await PermissionsAndroid.check(permission)) {
        return true;
    }
    return (
        (await PermissionsAndroid.request(permission)) ===
        PermissionsAndroid.RESULTS.GRANTED
    );
}

/**
 * 权限页的开关。还没授权就弹系统授权框；系统不会再弹框（之前选过「不再询问」），
 * 或者已经授权、用户想关掉（应用自己撤销不了），就打开本应用的系统设置页。
 * 返回操作结束时是否已授权。
 */
export async function toggleAndroidAudioReadPermission() {
    if (Platform.OS !== "android") {
        return true;
    }
    const permission = getRuntimeAudioReadPermission();
    if (await PermissionsAndroid.check(permission)) {
        await Linking.openSettings();
        return true;
    }
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
        return true;
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        await Linking.openSettings();
    }
    return false;
}

