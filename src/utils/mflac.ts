import { getLowerFileExtension } from "./mediaPath";

const encryptedMediaExtensions = new Set([".mflac", ".mflac0", ".mgg", ".mmp4"]);
const cencMediaExtensions = new Set([".mmp4"]);

export function normalizeEkey(ekey?: string | null) {
    const value = String(ekey ?? "").trim();
    return value.length > 704 ? value.slice(-704) : value;
}

export function normalizeCek(cek?: string | null) {
    return String(cek ?? "").trim();
}

export function isEncryptedMediaUrl(url?: string | null) {
    if (!url) {
        return false;
    }
    try {
        return encryptedMediaExtensions.has(getLowerFileExtension(url));
    } catch {
        return false;
    }
}

export function isCencMediaUrl(url?: string | null) {
    if (!url) {
        return false;
    }
    try {
        return cencMediaExtensions.has(getLowerFileExtension(url));
    } catch {
        return false;
    }
}

export function hasEncryptedMediaSource(
    url?: string | null,
    ekey?: string | null,
) {
    return !!normalizeEkey(ekey) || isEncryptedMediaUrl(url);
}
