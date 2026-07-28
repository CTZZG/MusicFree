export function createResolvedMediaSourceCacheEntry(
    result: IPlugin.IMediaSourceResult,
    requestedQuality: IMusic.IQualityKey,
): IMusic.IMediaSource {
    return {
        headers: result.headers,
        userAgent: result.userAgent,
        quality: result.quality ?? requestedQuality,
        ekey: result.ekey,
        cek: result.cek,
        url: result.url,
    };
}

export function readResolvedMediaSourceCache(
    mediaCache: IMusic.IMusicItem,
    requestedQuality: IMusic.IQualityKey,
    legacyQuality?: IMusic.IQualityKey,
): IPlugin.IMediaSourceResult | null {
    const qualityInfo =
        mediaCache.source?.[requestedQuality] ??
        (legacyQuality ? mediaCache.source?.[legacyQuality] : undefined);
    if (!qualityInfo?.url) {
        return null;
    }
    return {
        url: qualityInfo.url,
        headers: qualityInfo.headers ?? mediaCache.headers,
        userAgent:
            qualityInfo.userAgent ??
            mediaCache.userAgent ?? mediaCache.headers?.["user-agent"],
        quality: qualityInfo.quality ?? requestedQuality,
        ekey: qualityInfo.ekey ?? mediaCache.ekey,
        cek: qualityInfo.cek ?? mediaCache.cek,
    };
}
