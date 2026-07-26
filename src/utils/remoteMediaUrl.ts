import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";

export type RemoteMediaUrlValidation =
    | { ok: true; url: string }
    | { ok: false; reason: string };

export interface RemoteMediaUrlValidationOptions {
    allowHttp?: boolean;
}

export function validateRemoteMediaUrl(
    input: unknown,
    options: RemoteMediaUrlValidationOptions = {},
): RemoteMediaUrlValidation {
    const result = validateRemoteNetworkUrl(input, {
        allowHttp: options.allowHttp,
        subject: "媒体链接",
    });
    return result.ok
        ? { ok: true, url: result.url }
        : result;
}

/**
 * Media URL gate used right before handing a source to the player.
 *
 * The DNS pre-resolution step that used to live here was removed on 2026-07-26
 * together with the RemoteHostResolver native module: it cost a blocking native
 * round-trip per track while the native transports resolve the host again at
 * connect time anyway, so it could never be more than a TOCTOU pre-check.
 * Hostname/IP-literal and scheme policy still apply via validateRemoteMediaUrl.
 */
export async function validateRemoteMediaUrlForPlayback(
    input: unknown,
    options: RemoteMediaUrlValidationOptions = {},
): Promise<RemoteMediaUrlValidation> {
    return validateRemoteMediaUrl(input, options);
}
