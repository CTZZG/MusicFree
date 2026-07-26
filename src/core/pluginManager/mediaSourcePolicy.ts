import { validateRemoteMediaUrl } from "@/utils/remoteMediaUrl";
import type { RemoteMediaUrlValidationOptions } from "@/utils/remoteMediaUrl";

export type PluginMediaSourceValidation =
    | { ok: true; url: string }
    | { ok: false; reason: string };

function invalid(reason: string): PluginMediaSourceValidation {
    return {
        ok: false,
        reason,
    };
}

/**
 * Plugin-provided playback sources are limited to remote HTTPS media and
 * Android/iOS local document URLs. Internal loopback proxy URLs are created
 * later by TrackPlayer and never pass through this plugin boundary.
 */
export function validatePluginMediaSourceUrl(
    input: unknown,
    options: RemoteMediaUrlValidationOptions = {},
): PluginMediaSourceValidation {
    if (typeof input !== "string" || !input.trim()) {
        return invalid("媒体链接不能为空");
    }

    const candidate = input.trim();
    if (/^https?:\/\//i.test(candidate)) {
        return validateRemoteMediaUrl(candidate, options);
    }

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return invalid("媒体链接格式无效");
    }

    if (parsed.username || parsed.password) {
        return invalid("媒体链接不能包含账号凭据");
    }

    if (parsed.protocol === "file:") {
        if (parsed.hostname) {
            return invalid("媒体文件链接不能指向网络主机");
        }
        if (!parsed.pathname) {
            return invalid("媒体文件链接缺少路径");
        }
        return {
            ok: true,
            url: candidate,
        };
    }

    if (parsed.protocol === "content:") {
        if (!parsed.hostname || !parsed.pathname) {
            return invalid("媒体内容链接格式无效");
        }
        return {
            ok: true,
            url: candidate,
        };
    }

    return invalid("媒体链接协议不受支持");
}
