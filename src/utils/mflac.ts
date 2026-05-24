const encryptedMediaExtensions = ['.mflac', '.mflac0', '.mgg', '.mmp4'];

export function normalizeEkey(ekey?: string | null) {
    const value = String(ekey ?? '').trim();
    return value.length > 704 ? value.slice(-704) : value;
}

export function isEncryptedMediaUrl(url?: string | null) {
    if (!url) {
        return false;
    }
    try {
        const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
        return encryptedMediaExtensions.some(extension =>
            cleanUrl.endsWith(extension),
        );
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
