import { getLowerFileExtension } from "./mediaPath";

const qmcMediaExtensions = new Set([
    ".mflac",
    ".mflac0",
    ".mflac1",
    ".mflaca",
    ".mflach",
    ".mflacl",
    ".mflacm",
    ".mgg",
    ".mgg0",
    ".mgg1",
    ".mgga",
    ".mggh",
    ".mggl",
    ".mggm",
    ".qmc0",
    ".qmc2",
    ".qmc3",
    ".qmc4",
    ".qmc6",
    ".qmc8",
    ".qmcflac",
    ".qmcogg",
]);
const cencMediaExtensions = new Set([".mmp4"]);
const encryptedMediaExtensions = new Set([
    ...qmcMediaExtensions,
    ...cencMediaExtensions,
]);

export const MAX_QMC_EKEY_LENGTH = 64 * 1024;

export function normalizeEkey(ekey?: string | null) {
    return String(ekey ?? "").trim();
}

export function normalizeCek(cek?: string | null) {
    return String(cek ?? "").trim();
}

export function isEncryptedMediaExtension(extension?: string | null) {
    const normalized = String(extension ?? "").trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return encryptedMediaExtensions.has(
        normalized.startsWith(".") ? normalized : `.${normalized}`,
    );
}

export function isEncryptedMediaUrl(url?: string | null) {
    if (!url) {
        return false;
    }
    try {
        return isEncryptedMediaExtension(getLowerFileExtension(url));
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

export function isQmcMediaUrl(url?: string | null) {
    if (!url) {
        return false;
    }
    try {
        return qmcMediaExtensions.has(getLowerFileExtension(url));
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
