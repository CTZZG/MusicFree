import { Buffer } from "buffer";
import { validateRemoteNetworkUrl } from "@/utils/remoteNetworkPolicy";
import {
    createRestrictedHttpClient,
    RESTRICTED_HTTP_MAX_REQUEST_BYTES,
    RESTRICTED_HTTP_MAX_RESPONSE_BYTES,
    type RestrictedHttpClientOptions,
} from "@/utils/restrictedHttpClient";

interface WebdavModuleLike {
    AuthType?: Record<string, unknown>;
    createClient(
        remoteUrl: string,
        options?: Record<string, unknown>,
    ): any;
    getPatcher?: () => {
        patch(
            key: string,
            method: (...args: any[]) => unknown,
        ): unknown;
    };
}

interface RestrictedWebdavOptions {
    allowHttp?: boolean;
    allowPrivateHosts?: boolean;
    onPolicyViolation?: (reason: string) => void;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxTimeoutMs?: number;
    transportRequester?: RestrictedHttpClientOptions["requester"];
}

export const RESTRICTED_WEBDAV_MAX_TIMEOUT_MS = 15_000;
export const RESTRICTED_WEBDAV_TRANSPORT_MAX_BYTES = 32 * 1024 * 1024;

const SAFE_CLIENT_METHODS = [
    "copyFile",
    "createDirectory",
    "deleteFile",
    "exists",
    "getDirectoryContents",
    "getFileContents",
    "getQuota",
    "moveFile",
    "putFileContents",
    "stat",
] as const;

type SafeClientMethod = typeof SAFE_CLIENT_METHODS[number];

const METHOD_OPTIONS_INDEX: Record<SafeClientMethod, number> = {
    copyFile: 2,
    createDirectory: 1,
    deleteFile: 1,
    exists: 1,
    getDirectoryContents: 1,
    getFileContents: 1,
    getQuota: 0,
    moveFile: 2,
    putFileContents: 2,
    stat: 1,
};

interface RestrictedTransportState {
    authorizeRequest(
        signal: AbortSignal,
        authorization: RestrictedTransportAuthorization,
    ): () => void;
}

interface RestrictedTransportAuthorization {
    origin: string;
    transport: ReturnType<typeof createRestrictedHttpClient>;
}

const installedTransportPatchers = new WeakMap<
    object,
    RestrictedTransportState
>();

function byteLength(value: unknown) {
    if (value == null) {
        return 0;
    }
    if (typeof value === "string") {
        return Buffer.byteLength(value, "utf8");
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function validateRemotePath(value: unknown) {
    if (typeof value !== "string" || !value || value.includes("\0")) {
        throw new Error("WebDAV path is invalid");
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
        throw new Error("WebDAV path must not be an absolute URL");
    }
    const decoded = (() => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    })();
    if (decoded.split(/[\\/]/).includes("..")) {
        throw new Error("WebDAV parent path traversal is not allowed");
    }
}

function sanitizeOptions(options: Record<string, unknown> = {}) {
    return {
        username: options.username,
        password: options.password,
        token: options.token,
        authType: options.authType,
        headers: options.headers && typeof options.headers === "object"
            ? { ...(options.headers as object) }
            : undefined,
        maxRedirects: 0,
        withCredentials: false,
    };
}

function getHeaderValue(headers: unknown, name: string) {
    const normalizedName = name.toLowerCase();
    const candidate = headers as {
        get?: (headerName: string) => unknown;
        [key: string]: unknown;
    } | undefined;
    const directValue =
        candidate?.get?.(name) ??
        candidate?.[normalizedName] ??
        candidate?.[name];
    if (Array.isArray(directValue)) {
        return directValue.join(", ");
    }
    return directValue == null ? null : String(directValue);
}

async function toArrayBuffer(value: unknown): Promise<ArrayBuffer> {
    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        return view.buffer.slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
        ) as ArrayBuffer;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
        return value.arrayBuffer();
    }
    const buffer = Buffer.from(
        typeof value === "string"
            ? value
            : JSON.stringify(value ?? ""),
        "utf8",
    );
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
}

async function toText(value: unknown) {
    if (typeof value === "string") {
        return value;
    }
    const arrayBuffer = await toArrayBuffer(value);
    return Buffer.from(arrayBuffer).toString("utf8");
}

function createFetchCompatibleResponse(response: any) {
    const headers = Object.freeze({
        get(name: string) {
            return getHeaderValue(response.headers, name);
        },
        has(name: string) {
            return getHeaderValue(response.headers, name) !== null;
        },
    });
    const data = response.data;

    return Object.freeze({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText ?? "",
        url:
            response.request?.responseURL ??
            response.request?.url ??
            response.config?.url ??
            "",
        redirected: false,
        headers,
        text: () => toText(data),
        json: async () => JSON.parse(await toText(data)),
        arrayBuffer: () => toArrayBuffer(data),
    });
}

function installRestrictedTransport(
    webdavModule: WebdavModuleLike,
) {
    const patcher = webdavModule.getPatcher?.();
    if (!patcher || typeof patcher.patch !== "function") {
        throw new Error("Restricted WebDAV transport is unavailable");
    }
    const installedState = installedTransportPatchers.get(patcher as object);
    if (installedState) {
        return installedState;
    }

    const requestAuthorizations = new WeakMap<
        AbortSignal,
        RestrictedTransportAuthorization
    >();
    patcher.patch(
        "fetch",
        async (url: string, init: Record<string, unknown> = {}) => {
            let requestOrigin: string | undefined;
            try {
                requestOrigin = new URL(url).origin;
            } catch {
                // The selected transport performs the canonical URL validation.
            }
            const signal = init.signal as AbortSignal | undefined;
            const authorization = signal
                ? requestAuthorizations.get(signal)
                : undefined;
            const authorizedRequest = authorization?.origin === requestOrigin
                ? authorization
                : undefined;
            if (!authorizedRequest) {
                throw new Error(
                    "WebDAV transport request is not authorized",
                );
            }
            const response = await authorizedRequest.transport.request({
                url,
                method: init.method as string | undefined,
                headers: init.headers as Record<string, string> | undefined,
                data: init.body,
                signal: init.signal as AbortSignal | undefined,
                responseType: "arraybuffer",
                validateStatus: () => true,
            });
            return createFetchCompatibleResponse(response);
        },
    );
    const state: RestrictedTransportState = {
        authorizeRequest(signal, authorization) {
            requestAuthorizations.set(signal, authorization);
            return () => requestAuthorizations.delete(signal);
        },
    };
    installedTransportPatchers.set(patcher as object, state);
    return state;
}

function prepareOperation(
    method: SafeClientMethod,
    args: unknown[],
    maxTimeoutMs: number,
) {
    const safeArgs = [...args];
    const optionsIndex = METHOD_OPTIONS_INDEX[method];
    const suppliedOptions =
        safeArgs[optionsIndex] &&
        typeof safeArgs[optionsIndex] === "object"
            ? { ...(safeArgs[optionsIndex] as Record<string, unknown>) }
            : {};
    const suppliedSignal = suppliedOptions.signal as AbortSignal | undefined;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();

    if (suppliedSignal?.aborted) {
        forwardAbort();
    } else {
        suppliedSignal?.addEventListener("abort", forwardAbort, {
            once: true,
        });
    }
    safeArgs[optionsIndex] = {
        ...suppliedOptions,
        signal: controller.signal,
    };

    let timedOut = false;
    let rejectOperation: ((error: Error) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
        rejectOperation = reject;
    });
    const rejectFromAbort = () => {
        rejectOperation?.(
            new Error(
                timedOut
                    ? "WebDAV request timed out"
                    : "WebDAV request was cancelled",
            ),
        );
    };
    controller.signal.addEventListener("abort", rejectFromAbort, {
        once: true,
    });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, maxTimeoutMs);

    return {
        args: safeArgs,
        cancellation,
        signal: controller.signal,
        cleanup() {
            clearTimeout(timeout);
            suppliedSignal?.removeEventListener("abort", forwardAbort);
            controller.signal.removeEventListener("abort", rejectFromAbort);
        },
    };
}

export function createRestrictedWebdavFacade(
    webdavModule: WebdavModuleLike,
    options: RestrictedWebdavOptions = {},
) {
    const transportState = installRestrictedTransport(webdavModule);
    const maxRequestBytes =
        options.maxRequestBytes ?? RESTRICTED_HTTP_MAX_REQUEST_BYTES;
    const maxResponseBytes =
        options.maxResponseBytes ?? RESTRICTED_HTTP_MAX_RESPONSE_BYTES;
    const maxTimeoutMs = Math.max(
        1,
        Math.min(
            options.maxTimeoutMs ?? RESTRICTED_WEBDAV_MAX_TIMEOUT_MS,
            RESTRICTED_WEBDAV_MAX_TIMEOUT_MS,
        ),
    );
    const commonTransportOptions: RestrictedHttpClientOptions = {
        maxRequestBytes,
        maxResponseBytes,
        maxTimeoutMs,
        maxRedirects: 3,
        onPolicyViolation: options.onPolicyViolation,
        redirectPolicy: "same-origin",
        requester: options.transportRequester,
    };
    const httpsTransport = createRestrictedHttpClient({
        ...commonTransportOptions,
        allowPrivateHosts: options.allowPrivateHosts,
    });
    // 用户确认过的 HTTP WebDAV 走和 HTTPS 完全相同的 axios/fetch requester。
    // 之前这里挂的是一个专用的原生裸 socket 桥（Kotlin 746 行 + ObjC 1141 行），
    // 它存在的唯一理由是绕开平台的明文封锁；明文策略移到 app 代码之后该桥已删除，
    // HTTP 与 HTTPS 因此回到同一条代码路径（同样的重定向、超时、体积上限）。
    const httpTransport = createRestrictedHttpClient({
        ...commonTransportOptions,
        allowHttp: true,
        allowPrivateHosts: options.allowPrivateHosts,
    });

    const facade: any = {
        AuthType: Object.freeze({ ...(webdavModule.AuthType ?? {}) }),
        createClient(
            remoteUrl: string,
            clientOptions?: Record<string, unknown>,
        ) {
            const validation = validateRemoteNetworkUrl(remoteUrl, {
                allowHttp: options.allowHttp,
                allowPrivateHosts: options.allowPrivateHosts,
                subject: "WebDAV 链接",
            });
            if (!validation.ok) {
                options.onPolicyViolation?.("url-policy");
                throw new Error(validation.reason);
            }
            const parsedUrl = new URL(validation.url);
            const operationTransport = parsedUrl.protocol === "http:"
                ? httpTransport
                : httpsTransport;
            const requestAuthorization = {
                origin: parsedUrl.origin,
                transport: operationTransport,
            };
            const rawClient = webdavModule.createClient(
                validation.url,
                sanitizeOptions(clientOptions),
            );
            const safeClient: any = {};

            SAFE_CLIENT_METHODS.forEach(method => {
                const rawMethod = rawClient[method];
                if (typeof rawMethod !== "function") {
                    return;
                }
                safeClient[method] = async (...args: unknown[]) => {
                    if (method !== "getQuota") {
                        validateRemotePath(args[0]);
                    }
                    if (method === "copyFile" || method === "moveFile") {
                        validateRemotePath(args[1]);
                    }
                    if (
                        method === "createDirectory" &&
                        args[1] &&
                        typeof args[1] === "object" &&
                        (args[1] as Record<string, unknown>).recursive === true
                    ) {
                        throw new Error(
                            "Recursive WebDAV directory creation is unavailable in restricted mode",
                        );
                    }
                    if (
                        method === "putFileContents" &&
                        byteLength(args[1]) > maxRequestBytes
                    ) {
                        options.onPolicyViolation?.("request-size");
                        throw new Error(
                            "WebDAV request body exceeds the size limit",
                        );
                    }

                    const operation = prepareOperation(
                        method,
                        args,
                        maxTimeoutMs,
                    );
                    const releaseRequestAuthorization =
                        transportState.authorizeRequest(
                            operation.signal,
                            requestAuthorization,
                        );
                    try {
                        const result = await Promise.race([
                            rawMethod.apply(rawClient, operation.args),
                            operation.cancellation,
                        ]);
                        if (byteLength(result) > maxResponseBytes) {
                            options.onPolicyViolation?.("response-size");
                            throw new Error(
                                "WebDAV response body exceeds the size limit",
                            );
                        }
                        return result;
                    } catch (error) {
                        if (
                            error instanceof Error &&
                            (
                                error.message === "WebDAV request timed out" ||
                                error.message ===
                                    "WebDAV request was cancelled"
                            )
                        ) {
                            options.onPolicyViolation?.("transport-policy");
                        }
                        throw error;
                    } finally {
                        releaseRequestAuthorization();
                        operation.cleanup();
                    }
                };
            });
            return Object.freeze(safeClient);
        },
    };
    facade.default = facade;
    return Object.freeze(facade);
}
