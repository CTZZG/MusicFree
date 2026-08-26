import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";

const UI_LOCAL_ARTWORK_SCHEME =
    /^(?:file:|content:|data:image\/|asset:|ph:|android\.resource:)/i;
const NATIVE_LOCAL_ARTWORK_SCHEME =
    /^(?:file:|content:|android\.resource:)/i;

export function getArtworkUri(artwork: unknown) {
    if (typeof artwork === "string") {
        return artwork.trim();
    }
    if (
        artwork &&
        typeof artwork === "object" &&
        "uri" in artwork &&
        typeof artwork.uri === "string"
    ) {
        return artwork.uri.trim();
    }
    return "";
}

/**
 * 封面是纯展示资源，不是可执行内容，也不携带凭据。这里放行 http 与
 * https 两种；真正的地址安全（私有网段、回环、URL 内嵌凭据）由取图那一侧
 * 兜底——原生走 PublicHttpsNetworkPolicy，它对封面同样刻意不限制 scheme。
 *
 * 之前这里只放行 https，导致大量仍用 http 提供封面的音源（酷我等）在锁屏、
 * 通知和灵动岛上一律退化成默认图标：JS 把 artwork 置成 undefined，原生连
 * 尝试下载的机会都没有，且两侧都不打日志，症状与「音源没给封面」无法区分。
 */
function isPublicRemoteArtwork(uri: string) {
    return validateRemoteNetworkUrl(uri, {
        subject: "封面链接",
        allowHttp: true,
    }).ok;
}

const REMOTE_ARTWORK_SCHEME = /^https?:/i;

export function isUsableArtworkUri(artwork: unknown): artwork is string {
    const uri = getArtworkUri(artwork);
    if (!uri) {
        return false;
    }
    return REMOTE_ARTWORK_SCHEME.test(uri)
        ? isPublicRemoteArtwork(uri)
        : UI_LOCAL_ARTWORK_SCHEME.test(uri);
}

/**
 * Native metadata/notification code only accepts schemes that it can consume
 * without invoking another JavaScript or asset resolver.
 */
export function getNativeArtworkUri(artwork: unknown) {
    const uri = getArtworkUri(artwork);
    if (!uri) {
        return undefined;
    }
    if (REMOTE_ARTWORK_SCHEME.test(uri)) {
        return isPublicRemoteArtwork(uri) ? uri : undefined;
    }
    if (NATIVE_LOCAL_ARTWORK_SCHEME.test(uri) || uri.startsWith("/")) {
        return uri;
    }
    return undefined;
}
