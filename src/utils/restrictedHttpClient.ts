import axios, {
    type AxiosRequestConfig,
    type AxiosResponse,
} from "axios";
import { Buffer } from "buffer";
import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";

export const RESTRICTED_HTTP_MAX_TIMEOUT_MS = 15_000;
export const RESTRICTED_HTTP_MAX_CONCURRENCY = 4;
export const RESTRICTED_HTTP_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const RESTRICTED_HTTP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type Requester = (
    url: string,
    config: AxiosRequestConfig,
) => Promise<AxiosResponse>;

type FulfilledHandler<T> = (value: T) => T | Promise<T>;
type RejectedHandler = (error: unknown) => unknown;

interface Interceptor<T> {
    fulfilled: FulfilledHandler<T>;
    rejected?: RejectedHandler;
}

export interface RestrictedHttpClientOptions {
    requester?: Requester;
    /**
     * 传函数时每次请求都会重新求值，这样用户在设置里切换「允许插件使用 HTTP」
     * 之后立刻生效——插件的 capability context 和 LX runtime 都是模块加载时
     * 建好的，若捕获成布尔值就得重启才生效。
     */
    allowHttp?: boolean | (() => boolean);
    allowPrivateHosts?: boolean;
    maxConcurrency?: number;
    maxRedirects?: number;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxTimeoutMs?: number;
    onPolicyViolation?: (reason: string) => void;
    redirectPolicy?: "deny" | "same-origin";
}

class Semaphore {
    private active = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async acquire() {
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        await new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
        this.active += 1;
    }

    release() {
        this.active = Math.max(0, this.active - 1);
        this.queue.shift()?.();
    }
}

function byteLength(value: unknown) {
    if (value == null) {
        return 0;
    }
    if (typeof value === "string") {
        return Buffer.byteLength(value, "utf8");
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    if (
        typeof Blob !== "undefined" &&
        value instanceof Blob
    ) {
        return value.size;
    }
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function createInterceptorManager<T>(interceptors: Interceptor<T>[]) {
    return Object.freeze({
        use(
            fulfilled: FulfilledHandler<T>,
            rejected?: RejectedHandler,
        ) {
            const id = interceptors.length;
            interceptors.push({ fulfilled, rejected });
            return id;
        },
        eject(id: number) {
            delete interceptors[id];
        },
        clear() {
            interceptors.splice(0);
        },
    });
}

function resolveRequestUrl(
    url: string | undefined,
    baseURL: string | undefined,
) {
    if (!url) {
        throw new Error("Remote request URL is required");
    }
    if (!baseURL) {
        return url;
    }
    try {
        return new URL(url, baseURL).toString();
    } catch {
        throw new Error("Remote request URL is invalid");
    }
}

function getFinalResponseUrl(response: AxiosResponse) {
    const request = response.request as any;
    return (
        request?.responseURL ??
        response.headers?.["x-final-url"] ??
        request?.url ??
        null
    );
}

function isSameOrigin(left: string, right: string) {
    try {
        return new URL(left).origin === new URL(right).origin;
    } catch {
        return false;
    }
}

function getResponseHeader(response: AxiosResponse, name: string) {
    const headers = response.headers as any;
    const value = headers?.get?.(name) ??
        headers?.[name.toLowerCase()] ??
        headers?.[name];
    return value == null ? undefined : String(value);
}

function normalizeSetCookieHeaders(response: AxiosResponse) {
    const headers = response.headers as any;
    const setCookie = headers?.["set-cookie"];
    if (
        Array.isArray(setCookie) &&
        setCookie.length === 1 &&
        typeof setCookie[0] === "string"
    ) {
        headers["set-cookie"] = setCookie[0].split(",");
        headers["x-set-cookie"] = setCookie;
    }
    return response;
}

async function runFulfilledInterceptors<T>(
    value: T,
    interceptors: Interceptor<T>[],
) {
    let current = value;
    for (const interceptor of interceptors) {
        if (interceptor) {
            current = await interceptor.fulfilled(current);
        }
    }
    return current;
}

function normalizeTimeout(value: unknown, maxTimeoutMs: number) {
    const timeout = typeof value === "number" && Number.isFinite(value)
        ? value
        : maxTimeoutMs;
    return Math.max(1, Math.min(timeout, maxTimeoutMs));
}

export function createRestrictedHttpClient(
    options: RestrictedHttpClientOptions = {},
) {
    const requester = options.requester ?? (
        (url, config) => axios(url, config)
    );
    const resolveAllowHttp = () =>
        typeof options.allowHttp === "function"
            ? options.allowHttp()
            : options.allowHttp;
    const maxConcurrency = Math.max(
        1,
        options.maxConcurrency ?? RESTRICTED_HTTP_MAX_CONCURRENCY,
    );
    const maxRequestBytes =
        options.maxRequestBytes ?? RESTRICTED_HTTP_MAX_REQUEST_BYTES;
    const maxResponseBytes =
        options.maxResponseBytes ?? RESTRICTED_HTTP_MAX_RESPONSE_BYTES;
    const maxTimeoutMs =
        options.maxTimeoutMs ?? RESTRICTED_HTTP_MAX_TIMEOUT_MS;
    const redirectPolicy = options.redirectPolicy ?? "deny";
    const maxRedirects = Math.max(
        0,
        Math.min(options.maxRedirects ?? 3, 5),
    );
    const semaphore = new Semaphore(maxConcurrency);
    const requestInterceptors: Array<Interceptor<AxiosRequestConfig>> = [];
    const responseInterceptors: Array<Interceptor<AxiosResponse>> = [];

    const createClient = (
        initialDefaults: AxiosRequestConfig = {},
    ): any => {
        const defaults: AxiosRequestConfig = {
            ...initialDefaults,
            headers: initialDefaults.headers
                ? { ...(initialDefaults.headers as any) }
                : {},
            timeout: normalizeTimeout(initialDefaults.timeout, maxTimeoutMs),
        };

        const request = async (
            urlOrConfig: string | AxiosRequestConfig,
            maybeConfig: AxiosRequestConfig = {},
        ) => {
            const suppliedConfig = typeof urlOrConfig === "string"
                ? { ...maybeConfig, url: urlOrConfig }
                : { ...urlOrConfig };
            const interceptedConfig = await runFulfilledInterceptors(
                {
                    ...defaults,
                    ...suppliedConfig,
                    headers: {
                        ...(defaults.headers as any),
                        ...(suppliedConfig.headers as any),
                    },
                },
                requestInterceptors,
            );
            const requestUrl = resolveRequestUrl(
                interceptedConfig.url,
                interceptedConfig.baseURL,
            );
            const validation = validateRemoteNetworkUrl(requestUrl, {
                allowHttp: resolveAllowHttp(),
                allowPrivateHosts: options.allowPrivateHosts,
                subject: "远程请求链接",
            });
            if (!validation.ok) {
                options.onPolicyViolation?.("url-policy");
                throw new Error(validation.reason);
            }
            if (byteLength(interceptedConfig.data) > maxRequestBytes) {
                options.onPolicyViolation?.("request-size");
                throw new Error("Remote request body exceeds the size limit");
            }

            const safeConfig: AxiosRequestConfig = {
                adapter: "fetch",
                method: interceptedConfig.method,
                headers: interceptedConfig.headers,
                params: interceptedConfig.params,
                data: interceptedConfig.data,
                responseType: interceptedConfig.responseType,
                responseEncoding: interceptedConfig.responseEncoding,
                signal: interceptedConfig.signal,
                cancelToken: interceptedConfig.cancelToken,
                auth: interceptedConfig.auth,
                validateStatus: redirectPolicy === "same-origin"
                    ? () => true
                    : interceptedConfig.validateStatus,
                timeout: normalizeTimeout(
                    interceptedConfig.timeout,
                    maxTimeoutMs,
                ),
                maxBodyLength: maxRequestBytes,
                maxContentLength: maxResponseBytes,
                maxRedirects: 0,
                withCredentials: false,
                fetchOptions: {
                    redirect: redirectPolicy === "same-origin"
                        ? "manual"
                        : "error",
                },
            };

            await semaphore.acquire();
            try {
                let currentUrl = validation.url;
                let redirectCount = 0;
                let response: AxiosResponse;
                while (true) {
                    response = normalizeSetCookieHeaders(
                        await requester(currentUrl, safeConfig),
                    );
                    const finalUrl = getFinalResponseUrl(response);
                    if (finalUrl) {
                        const finalValidation = validateRemoteNetworkUrl(
                            finalUrl,
                            {
                                allowHttp: resolveAllowHttp(),
                                allowPrivateHosts:
                                    options.allowPrivateHosts,
                                subject: "响应链接",
                            },
                        );
                        // Only the origin is transport-security relevant here.
                        // axios serializes `params` into the final URL, so a
                        // full-string compare against the param-less request
                        // URL would reject every ordinary query request.
                        if (
                            !finalValidation.ok ||
                            !isSameOrigin(finalValidation.url, currentUrl)
                        ) {
                            options.onPolicyViolation?.("redirect");
                            throw new Error(
                                "Unverified transport redirects are not allowed",
                            );
                        }
                    }

                    if (response.status < 300 || response.status >= 400) {
                        break;
                    }
                    if (redirectPolicy !== "same-origin") {
                        options.onPolicyViolation?.("redirect");
                        throw new Error("Remote redirects are not allowed");
                    }
                    if (redirectCount >= maxRedirects) {
                        options.onPolicyViolation?.("redirect");
                        throw new Error("Remote redirect limit exceeded");
                    }
                    const location = getResponseHeader(response, "location");
                    if (!location) {
                        options.onPolicyViolation?.("redirect");
                        throw new Error("Remote redirect location is missing");
                    }
                    let redirectedUrl: string;
                    try {
                        redirectedUrl = new URL(location, currentUrl).toString();
                    } catch {
                        options.onPolicyViolation?.("redirect");
                        throw new Error("Remote redirect URL is invalid");
                    }
                    const redirectValidation = validateRemoteNetworkUrl(
                        redirectedUrl,
                        {
                            allowHttp: resolveAllowHttp(),
                            allowPrivateHosts: options.allowPrivateHosts,
                            subject: "重定向链接",
                        },
                    );
                    if (
                        !redirectValidation.ok ||
                        !isSameOrigin(redirectValidation.url, currentUrl)
                    ) {
                        options.onPolicyViolation?.("redirect");
                        throw new Error(
                            "Only same-origin redirects allowed by the transport policy",
                        );
                    }
                    currentUrl = redirectValidation.url;
                    redirectCount += 1;
                }
                if (byteLength(response.data) > maxResponseBytes) {
                    options.onPolicyViolation?.("response-size");
                    throw new Error(
                        "Remote response body exceeds the size limit",
                    );
                }
                response = await runFulfilledInterceptors(
                    response,
                    responseInterceptors,
                );
                return response;
            } catch (error) {
                let currentError = error;
                for (const interceptor of responseInterceptors) {
                    if (interceptor?.rejected) {
                        currentError = await interceptor.rejected(currentError);
                    }
                }
                throw currentError;
            } finally {
                semaphore.release();
            }
        };

        const client: any = (
            urlOrConfig: string | AxiosRequestConfig,
            config?: AxiosRequestConfig,
        ) => request(urlOrConfig, config);
        client.request = (config: AxiosRequestConfig) => request(config);
        for (const method of ["delete", "get", "head", "options"] as const) {
            client[method] = (url: string, config?: AxiosRequestConfig) =>
                request(url, { ...config, method });
        }
        for (const method of ["post", "put", "patch"] as const) {
            client[method] = (
                url: string,
                data?: unknown,
                config?: AxiosRequestConfig,
            ) => request(url, { ...config, data, method });
        }
        client.create = (config?: AxiosRequestConfig) =>
            createClient({ ...defaults, ...config });
        client.getUri = (config: AxiosRequestConfig = {}) =>
            resolveRequestUrl(config.url, config.baseURL ?? defaults.baseURL);
        client.defaults = defaults;
        client.interceptors = Object.freeze({
            request: createInterceptorManager(requestInterceptors),
            response: createInterceptorManager(responseInterceptors),
        });
        client.isAxiosError = axios.isAxiosError;
        client.all = Promise.all.bind(Promise);
        client.spread = (callback: (...values: any[]) => unknown) =>
            (values: any[]) => callback(...values);
        client.default = client;
        return Object.preventExtensions(client);
    };

    return createClient();
}
