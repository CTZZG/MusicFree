import { validateRemoteInstallUrl } from "@/utils/remoteInstallUrl";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";

const MAX_LX_SOURCE_BYTES = 2 * 1024 * 1024;
const remoteHttpClient = createRestrictedHttpClient({
    maxResponseBytes: MAX_LX_SOURCE_BYTES,
});

export interface IRemoteLxSource {
    script: string;
    sourceUrl: string;
}

export async function downloadRemoteLxSource(
    input: string,
): Promise<IRemoteLxSource> {
    const validation = validateRemoteInstallUrl(input);
    if (!validation.ok) {
        throw new Error(validation.reason);
    }

    const response = await remoteHttpClient.get(validation.url, {
        headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Expires: "0",
        },
        maxBodyLength: MAX_LX_SOURCE_BYTES,
        maxContentLength: MAX_LX_SOURCE_BYTES,
        maxRedirects: 0,
        timeout: 15_000,
        transformResponse: data => data,
    });

    const script = String(response.data ?? "");
    if (!script.trim()) {
        throw new Error("LX custom source is empty");
    }
    if (script.length > MAX_LX_SOURCE_BYTES) {
        throw new Error("LX custom source is too large");
    }

    return {
        script,
        sourceUrl: validation.url,
    };
}
