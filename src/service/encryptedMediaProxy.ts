import Cenc from "@/native/cenc";
import Qmc, { IQmcStreamInfo } from "@/native/qmc";
import {
    MAX_QMC_EKEY_LENGTH,
    hasEncryptedMediaSource,
    isCencMediaUrl,
    isQmcMediaUrl,
    normalizeCek,
    normalizeEkey,
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

export function isQmcEncryptedMediaSource(
    source?: IEncryptedMediaSource | null,
) {
    const ekey = normalizeEkey(source?.ekey);
    return !!source?.url &&
        isHttpUrl(source.url) &&
        !isCencMediaUrl(source.url) &&
        (isQmcMediaUrl(source.url) || !!ekey);
}

export function getPlayableQmcEkey(source?: IEncryptedMediaSource | null) {
    if (!isQmcEncryptedMediaSource(source)) {
        return undefined;
    }
    const ekey = normalizeEkey(source?.ekey);
    return ekey && ekey.length <= MAX_QMC_EKEY_LENGTH ? ekey : undefined;
}

function hasValidQmcKeyShape(source?: IEncryptedMediaSource | null) {
    const ekey = normalizeEkey(source?.ekey);
    return !ekey || ekey.length <= MAX_QMC_EKEY_LENGTH;
}

export function canProxyQmcSource(source?: IEncryptedMediaSource | null) {
    return Qmc.isAvailable() &&
        isQmcEncryptedMediaSource(source) &&
        hasValidQmcKeyShape(source);
}

export async function inspectQmcMediaSource(
    source: IEncryptedMediaSource,
): Promise<IQmcStreamInfo> {
    if (!canProxyQmcSource(source) || !source.url) {
        throw new Error("QMC media source is not decryptable on this platform");
    }
    return Qmc.inspectStream(
        source.url,
        getPlayableQmcEkey(source),
        headersWithUserAgent(source),
    );
}

export function isUnsupportedEncryptedMediaSource(
    source?: IEncryptedMediaSource | null,
) {
    return (
        hasEncryptedMediaSource(source?.url, source?.ekey) &&
        !canProxyCencSource(source) &&
        !canProxyQmcSource(source)
    );
}

export async function resolveEncryptedMediaStreamIfNeeded<
    T extends IEncryptedMediaSource | null | undefined,
>(source: T): Promise<T> {
    if (!source?.url) {
        return source;
    }

    let localUrl: string;
    if (canProxyCencSource(source)) {
        const cek = getPlayableCencKey(source)!;
        localUrl = await Cenc.registerStream(
            source.url,
            cek,
            headersWithUserAgent(source),
        );
    } else if (canProxyQmcSource(source)) {
        localUrl = await Qmc.registerStream(
            source.url,
            getPlayableQmcEkey(source),
            headersWithUserAgent(source),
        );
    } else {
        return source;
    }
    if (!isLocalProxyUrl(localUrl)) {
        throw new Error("Encrypted-media native module returned an invalid local stream URL");
    }

    return {
        ...source,
        url: localUrl,
        headers: undefined,
        ekey: undefined,
        trustedLocalMediaProxy: true,
    } as T;
}
