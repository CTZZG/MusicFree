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

function isPublicHttpsArtwork(uri: string) {
    return validateRemoteNetworkUrl(uri, {
        subject: "封面链接",
    }).ok;
}

export function isUsableArtworkUri(artwork: unknown): artwork is string {
    const uri = getArtworkUri(artwork);
    if (!uri) {
        return false;
    }
    return /^https:/i.test(uri)
        ? isPublicHttpsArtwork(uri)
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
    if (/^https:/i.test(uri)) {
        return isPublicHttpsArtwork(uri) ? uri : undefined;
    }
    if (NATIVE_LOCAL_ARTWORK_SCHEME.test(uri) || uri.startsWith("/")) {
        return uri;
    }
    return undefined;
}
