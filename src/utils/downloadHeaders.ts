export function createDownloadHeaders(
    headers?: Record<string, unknown> | null,
    userAgent?: string | null,
) {
    const normalized: Record<string, string> = {};
    Object.entries(headers ?? {}).forEach(([key, value]) => {
        const headerName = key.trim();
        if (!headerName || value === null || value === undefined) {
            return;
        }
        const headerValue = String(value).trim();
        if (headerValue) {
            normalized[headerName] = headerValue;
        }
    });

    const hasUserAgent = Object.keys(normalized).some(
        key => key.toLowerCase() === "user-agent",
    );
    const normalizedUserAgent = userAgent?.trim();
    if (!hasUserAgent && normalizedUserAgent) {
        normalized["User-Agent"] = normalizedUserAgent;
    }

    return Object.keys(normalized).length ? normalized : undefined;
}
