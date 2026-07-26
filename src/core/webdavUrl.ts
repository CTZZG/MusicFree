import { validateRemoteNetworkUrl } from "@/utils/remoteNetworkPolicy";

export type WebdavUrlValidation =
    | { ok: true; url: string }
    | { ok: false; reason: string };

/**
 * WebDAV credentials are configured separately and must not be embedded in
 * the URL. HTTPS is preferred, while an explicitly user-configured HTTP URL
 * remains available as a compatibility path after the settings UI warns.
 */
export function validateWebdavUrl(input: string): WebdavUrlValidation {
    const result = validateRemoteNetworkUrl(input, {
        // This endpoint is explicitly configured by the user. Private and
        // HTTP NAS endpoints are valid here, unlike URLs supplied by plugins.
        allowHttp: true,
        allowPrivateHosts: true,
        subject: "WebDAV URL",
    });
    return result.ok
        ? {
            ok: true,
            url: result.url.replace(/#.*$/, ""),
        }
        : result;
}

export function isHttpWebdavUrl(input: string) {
    const validation = validateWebdavUrl(input);
    return validation.ok && new URL(validation.url).protocol === "http:";
}

export function requiresWebdavHttpConfirmation(
    currentUrl: string | undefined,
    nextUrl: string,
) {
    const nextValidation = validateWebdavUrl(nextUrl);
    if (
        !nextValidation.ok ||
        new URL(nextValidation.url).protocol !== "http:"
    ) {
        return false;
    }
    const currentValidation = currentUrl
        ? validateWebdavUrl(currentUrl)
        : undefined;
    return !currentValidation?.ok ||
        currentValidation.url !== nextValidation.url;
}
