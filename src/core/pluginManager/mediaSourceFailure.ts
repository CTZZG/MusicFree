import type { ILanguageData } from "@/types/core/i18n";

export type MediaSourceFailureCode =
    | "unavailable"
    | "network-error"
    | "plugin-error"
    | "invalid-url"
    | "policy-blocked"
    | "encrypted-unsupported"
    | "source-rejected"
    | "backend-error";

export interface MediaSourceFailureContext {
    mediaKey?: string;
    pluginName?: string;
    quality?: IMusic.IQualityKey;
}

export interface MediaSourceFailure extends MediaSourceFailureContext {
    code: MediaSourceFailureCode;
    retryable: boolean;
    createdAt: number;
}

export type MediaSourceAttemptType = "original" | "similar";

const mediaSourceFailureCodes = new Set<MediaSourceFailureCode>([
    "unavailable",
    "network-error",
    "plugin-error",
    "invalid-url",
    "policy-blocked",
    "encrypted-unsupported",
    "source-rejected",
    "backend-error",
]);

const retryableByCode: Record<MediaSourceFailureCode, boolean> = {
    unavailable: false,
    "network-error": true,
    "plugin-error": true,
    "invalid-url": false,
    "policy-blocked": false,
    "encrypted-unsupported": false,
    "source-rejected": false,
    "backend-error": true,
};

const failurePriority: Record<MediaSourceFailureCode, number> = {
    unavailable: 10,
    "backend-error": 20,
    "plugin-error": 30,
    "network-error": 40,
    "source-rejected": 50,
    "invalid-url": 60,
    "policy-blocked": 70,
    "encrypted-unsupported": 80,
};

const unavailableErrorCodes = new Set([
    "MEDIA_SOURCE_UNAVAILABLE",
    "QUALITY_UNAVAILABLE",
    "UNSUPPORTED_QUALITY",
    "NOT RETRY",
]);

const networkErrorCodes = new Set([
    "MEDIA_SOURCE_NETWORK_ERROR",
    "ERR_NETWORK",
    "ECONNABORTED",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
]);

export function createMediaSourceFailure(
    code: MediaSourceFailureCode,
    context: MediaSourceFailureContext = {},
    retryable?: boolean,
): MediaSourceFailure {
    const safeCode = mediaSourceFailureCodes.has(code)
        ? code
        : "plugin-error";
    return {
        ...context,
        code: safeCode,
        retryable:
            typeof retryable === "boolean"
                ? retryable
                : retryableByCode[safeCode],
        createdAt: Date.now(),
    };
}

export class MediaSourceResolutionError extends Error {
    readonly mediaSourceFailure: MediaSourceFailure;
    readonly code: MediaSourceFailureCode;

    constructor(
        code: MediaSourceFailureCode,
        message: string,
        context: MediaSourceFailureContext = {},
        retryable?: boolean,
    ) {
        super(message);
        this.name = "MediaSourceResolutionError";
        this.mediaSourceFailure = createMediaSourceFailure(
            code,
            context,
            retryable,
        );
        this.code = this.mediaSourceFailure.code;
    }
}

function normalizeErrorCode(error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function normalizeErrorMessage(error: unknown) {
    const message =
        (error as { message?: unknown } | null)?.message ?? String(error ?? "");
    return String(message).trim().toLowerCase();
}

export function classifyMediaSourceFailure(
    error: unknown,
    context: MediaSourceFailureContext = {},
): MediaSourceFailure {
    if (error instanceof MediaSourceResolutionError) {
        return {
            ...error.mediaSourceFailure,
            ...context,
        };
    }

    const errorCode = normalizeErrorCode(error);
    const message = normalizeErrorMessage(error);
    if (
        unavailableErrorCodes.has(errorCode) ||
        message === "not retry"
    ) {
        return createMediaSourceFailure("unavailable", context);
    }
    if (networkErrorCodes.has(errorCode)) {
        return createMediaSourceFailure("network-error", context);
    }
    if (errorCode === "MEDIA_SOURCE_INVALID_URL") {
        return createMediaSourceFailure("invalid-url", context);
    }
    if (errorCode === "MEDIA_SOURCE_POLICY_BLOCKED") {
        return createMediaSourceFailure("policy-blocked", context);
    }
    if (errorCode === "MEDIA_SOURCE_ENCRYPTED_UNSUPPORTED") {
        return createMediaSourceFailure("encrypted-unsupported", context);
    }
    if (errorCode === "MEDIA_SOURCE_BACKEND_ERROR") {
        return createMediaSourceFailure("backend-error", context);
    }

    if (
        /(?:不支持|暂无|无可用|无音质|未返回).*(?:音质|播放|音源|地址)|(?:unsupported|unavailable).*(?:quality|source)/i.test(
            message,
        )
    ) {
        return createMediaSourceFailure("unavailable", context);
    }
    if (
        /(?:network error|timeout|timed out|socket|econn|enet|enotfound|网络|超时|连接失败)/i.test(
            message,
        )
    ) {
        return createMediaSourceFailure("network-error", context);
    }
    if (
        /(?:(?:qmc|cenc|encrypted|decrypt|decryption).*(?:key|container|format|unsupported|invalid|missing|failed)|(?:密钥|容器|格式).*(?:无效|缺失|不支持|失败))/i.test(
            message,
        )
    ) {
        return createMediaSourceFailure("encrypted-unsupported", context);
    }
    if (
        /(?:格式无效|链接不能为空|为空或过长|缺少路径|协议不受支持|invalid url|required url)/i.test(
            message,
        )
    ) {
        return createMediaSourceFailure("invalid-url", context);
    }
    if (
        /(?:仅允许使用|不允许访问|不能包含用户名或密码|账号凭据|私网|环回|保留地址|policy)/i.test(
            message,
        )
    ) {
        return createMediaSourceFailure("policy-blocked", context);
    }

    return createMediaSourceFailure("plugin-error", context);
}

export function mediaSourceFailureFromPluginResult(
    failure: IPlugin.IMediaSourceFailure | undefined,
    context: MediaSourceFailureContext,
) {
    if (!failure) {
        return createMediaSourceFailure("unavailable", context);
    }
    return createMediaSourceFailure(
        failure.code,
        context,
        failure.retryable,
    );
}

export function createMediaSourceFailureResult(
    failure: MediaSourceFailure,
): IPlugin.IMediaSourceResult {
    return {
        failure: {
            code: failure.code,
            retryable: failure.retryable,
        },
    };
}

export function preferMediaSourceFailure(
    current: MediaSourceFailure | null | undefined,
    candidate: MediaSourceFailure | null | undefined,
) {
    if (!candidate) {
        return current ?? null;
    }
    if (
        !current ||
        failurePriority[candidate.code] >= failurePriority[current.code]
    ) {
        return candidate;
    }
    return current;
}

export function preferUserFacingMediaSourceFailure(
    current: MediaSourceFailure | null | undefined,
    candidate: MediaSourceFailure | null | undefined,
    attemptType: MediaSourceAttemptType,
) {
    if (attemptType === "similar") {
        return current ?? null;
    }
    return preferMediaSourceFailure(current, candidate);
}

export const mediaSourceFailureI18nKeys: Record<
    MediaSourceFailureCode,
    keyof ILanguageData
> = {
    unavailable: "toast.mediaSourceUnavailable",
    "network-error": "toast.mediaSourceNetworkError",
    "plugin-error": "toast.mediaSourcePluginError",
    "invalid-url": "toast.mediaSourceInvalidUrl",
    "policy-blocked": "toast.mediaSourcePolicyBlocked",
    "encrypted-unsupported": "toast.mediaSourceEncryptedUnsupported",
    "source-rejected": "toast.mediaSourceRejected",
    "backend-error": "toast.mediaSourceBackendError",
};

export function getMediaSourceFailureI18nKey(code: unknown): keyof ILanguageData {
    return typeof code === "string" &&
        mediaSourceFailureCodes.has(code as MediaSourceFailureCode)
        ? mediaSourceFailureI18nKeys[code as MediaSourceFailureCode]
        : mediaSourceFailureI18nKeys["plugin-error"];
}
