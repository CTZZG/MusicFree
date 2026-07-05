import type { PlayerAdapterPlaybackError } from "@/core/playerAdapter";

const unrecoverableRemoteSourcePatterns = [
    "container",
    "malformed",
    "unsupported",
    "unsupported format",
    "invalid_http_content_type",
    "invalid http content type",
    "invalid content type",
    "parse",
    "parsing",
    "parser",
    "demux",
    "demuxer",
    "decode",
    "decoder",
    "codec",
    "format",
    "unrecognized",
];

const unrecoverableRemoteSourceStatusCodes = new Set([
    "401",
    "403",
    "404",
    "410",
    "416",
]);

function stringifyErrorField(value: unknown) {
    if (value == null) {
        return "";
    }
    if (typeof value === "string" || typeof value === "number") {
        return String(value);
    }
    return "";
}

export function shouldEvictRecoveredRemoteSourceCacheAfterFailure(options: {
    error?: Partial<PlayerAdapterPlaybackError> | null;
    isLocalSource: boolean;
    wasRecoveredSource: boolean;
}) {
    const { error, isLocalSource, wasRecoveredSource } = options;
    if (isLocalSource || !wasRecoveredSource) {
        return false;
    }

    const errorText = [
        error?.code,
        error?.message,
        error?.nativeCode,
        error?.nativeMessage,
        error?.reason,
        error?.state,
    ]
        .map(stringifyErrorField)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (
        unrecoverableRemoteSourcePatterns.some(pattern =>
            errorText.includes(pattern),
        )
    ) {
        return true;
    }

    const statusCodeMatches = errorText.match(/\b\d{3}\b/g) ?? [];
    return statusCodeMatches.some(code =>
        unrecoverableRemoteSourceStatusCodes.has(code),
    );
}
