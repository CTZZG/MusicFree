import Cenc from "@/native/cenc";
import {
    hasEncryptedMediaSource,
    isCencMediaUrl,
    normalizeCek,
} from "@/utils/mflac";
import { createDownloadHeaders } from "@/utils/downloadHeaders";

export interface IEncryptedMediaSource {
    url?: string | null;
    headers?: Record<string, unknown> | null;
    userAgent?: string | null;
    ekey?: string | null;
    cek?: string | null;
    [key: string]: any;
}

const cencKeyPattern = /^[0-9a-fA-F]{32}$/;

function isHttpUrl(url?: string | null) {
    return !!url && /^https?:\/\//i.test(url);
}

function headersWithUserAgent(source: IEncryptedMediaSource) {
    return createDownloadHeaders(source.headers, source.userAgent);
}

function isLocalProxyUrl(url?: string | null) {
    return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//i.test(url ?? "");
}

export function getPlayableCencKey(source?: IEncryptedMediaSource | null) {
    const cek = normalizeCek(source?.cek);
    return source?.url &&
        isHttpUrl(source.url) &&
        isCencMediaUrl(source.url) &&
        cencKeyPattern.test(cek)
        ? cek
        : undefined;
}

export function canProxyCencSource(source?: IEncryptedMediaSource | null) {
    return Cenc.isAvailable() && !!getPlayableCencKey(source);
}

export function isUnsupportedEncryptedMediaSource(
    source?: IEncryptedMediaSource | null,
) {
    return (
        hasEncryptedMediaSource(source?.url, source?.ekey) &&
        !canProxyCencSource(source)
    );
}

export async function resolveEncryptedMediaStreamIfNeeded<
    T extends IEncryptedMediaSource | null | undefined,
>(source: T): Promise<T> {
    if (!source?.url || !canProxyCencSource(source)) {
        return source;
    }

    const cek = getPlayableCencKey(source)!;
    const localUrl = await Cenc.registerStream(
        source.url,
        cek,
        headersWithUserAgent(source),
    );
    if (!isLocalProxyUrl(localUrl)) {
        throw new Error("CENC native module returned an invalid local stream URL");
    }

    return {
        ...source,
        url: localUrl,
        headers: undefined,
        ekey: undefined,
        trustedLocalMediaProxy: true,
    } as T;
}
