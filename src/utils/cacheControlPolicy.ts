export type CacheControlValue =
    | "cache"
    | "no-cache"
    | "no-store";

export function parseCacheControl(value?: string | null): CacheControlValue {
    switch (value?.toLowerCase()) {
    case "cache":
        return "cache";
    case "no-store":
        return "no-store";
    default:
        return "no-cache";
    }
}

export function canReadResolvedSourceCache(
    cacheControl: string | null | undefined,
    isOffline: boolean,
) {
    const policy = parseCacheControl(cacheControl);
    return policy === "cache" || (policy === "no-cache" && isOffline);
}

export function canWriteResolvedSourceCache(
    cacheControl: string | null | undefined,
) {
    return parseCacheControl(cacheControl) !== "no-store";
}
