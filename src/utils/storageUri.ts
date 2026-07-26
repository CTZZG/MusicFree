export type StorageUriKind =
    | "app-scoped-path"
    | "content-uri"
    | "file-path"
    | "file-uri"
    | "unsupported";

export interface StorageUriClassification {
    kind: StorageUriKind;
    original: string;
    filePath?: string;
    isAppScoped: boolean;
}

function normalizePathForComparison(value: string) {
    return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathWithin(path: string, root: string) {
    const normalizedPath = normalizePathForComparison(path);
    const normalizedRoot = normalizePathForComparison(root);
    return (
        normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}/`)
    );
}

function decodeFileUri(value: string) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "file:" || (parsed.hostname && parsed.hostname !== "localhost")) {
            return null;
        }
        return decodeURIComponent(parsed.pathname);
    } catch {
        return null;
    }
}

export function classifyStorageUri(
    value: string,
    appScopedRoots: readonly string[] = [],
): StorageUriClassification {
    const original = typeof value === "string" ? value.trim() : "";
    if (!original) {
        return {
            kind: "unsupported",
            original,
            isAppScoped: false,
        };
    }

    if (/^content:\/\//i.test(original)) {
        return {
            kind: "content-uri",
            original,
            isAppScoped: false,
        };
    }

    let filePath: string | null = null;
    let kind: StorageUriKind = "unsupported";
    if (/^file:\/\//i.test(original)) {
        filePath = decodeFileUri(original);
        kind = filePath ? "file-uri" : "unsupported";
    } else if (
        original.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(original)
    ) {
        filePath = original;
        kind = "file-path";
    }

    if (!filePath) {
        return {
            kind,
            original,
            isAppScoped: false,
        };
    }

    const isAppScoped = appScopedRoots
        .filter(Boolean)
        .some(root => isPathWithin(filePath!, root));
    return {
        kind: isAppScoped ? "app-scoped-path" : kind,
        original,
        filePath,
        isAppScoped,
    };
}

export function isContentUri(value: string | null | undefined): value is string {
    return typeof value === "string" && /^content:\/\//i.test(value.trim());
}

export function requireFilePath(
    value: string,
    appScopedRoots: readonly string[] = [],
) {
    const classification = classifyStorageUri(value, appScopedRoots);
    if (!classification.filePath) {
        throw new Error(
            classification.kind === "content-uri"
                ? "A content URI cannot be used as a file-system path"
                : "Unsupported storage location",
        );
    }
    return classification.filePath;
}

