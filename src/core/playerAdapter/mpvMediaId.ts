export function encodeMpvMediaId(id: string): string {
    return encodeURIComponent(id);
}

function decodeMpvMediaId(id: string): string | null {
    try {
        return decodeURIComponent(id);
    } catch {
        return null;
    }
}

export function matchesMpvMediaId(
    key: string,
    trackId: string,
    candidate: string,
): boolean {
    const decodedCandidate = decodeMpvMediaId(candidate);
    const candidates = new Set([
        candidate,
        decodedCandidate,
    ].filter((value): value is string => typeof value === "string"));

    return (
        candidates.has(key) ||
        candidates.has(trackId) ||
        candidate === encodeMpvMediaId(key) ||
        candidate === encodeMpvMediaId(trackId)
    );
}
