import { createDownloadHeaders } from "@/utils/downloadHeaders";

export interface ILxSourceReachabilityHeaderInput {
    headers?: Record<string, unknown> | null;
    userAgent?: string | null;
}

export function createReachableMediaSourceHeaders(
    result: ILxSourceReachabilityHeaderInput,
) {
    return {
        ...(createDownloadHeaders(result.headers, result.userAgent) ?? {}),
        Range: "bytes=0-0",
    };
}
