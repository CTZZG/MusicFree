import { Linking, PermissionsAndroid, Platform } from "react-native";
import StorageUri from "@/native/storageUri";

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

/**
 * 系统音乐库（MediaStore）给的 URI。和 SAF 的 URI 不同，它不带授权：读别的应用
 * 放进来的文件要有音频读取权限。
 */
export function isMediaStoreUri(localPath: string | null | undefined) {
    return !!localPath && localPath.startsWith("content://media/");
}

/**
 * 这个 content URI 现在读不读得到。读不到的系统音乐库 URI 在没有音频读取权限时
 * 返回 null：文件可能还在，只是没权限，不能说它不存在。
 */
export async function resolveContentUriReadable(
    uri: string,
): Promise<boolean | null> {
    const readable = await StorageUri.exists(uri).catch(() => false);
    if (readable || !isMediaStoreUri(uri)) {
        return readable;
    }
    return (await checkAndroidAudioReadPermission()) ? false : null;
}

/**
 * 播放前要不要先拿音频读取权限：裸文件路径要；系统音乐库的 URI 在读不到、而且
 * 没有权限时要（应用自己放进媒体库的文件没有权限也读得到）；SAF 的 URI 不要。
 */
export async function needsAudioReadPermissionToPlay(
    localPath: string | null | undefined,
) {
    if (Platform.OS !== "android" || !localPath) {
        return false;
    }
    if (requiresAudioReadPermission(localPath)) {
        return true;
    }
    return (
        isMediaStoreUri(localPath) &&
        (await resolveContentUriReadable(localPath)) === null
    );
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

