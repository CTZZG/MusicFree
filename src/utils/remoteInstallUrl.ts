import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";

export type RemoteInstallUrlValidation =
    | { ok: true; url: string; hostname: string }
    | { ok: false; reason: string };

export function validateRemoteInstallUrl(input: string): RemoteInstallUrlValidation {
    const result = validateRemoteNetworkUrl(input);
    return result.ok
        ? {
            ok: true,
            url: result.url,
            hostname: result.hostname,
        }
        : result;
}
