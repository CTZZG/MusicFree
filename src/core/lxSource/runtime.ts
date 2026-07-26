import type { AxiosRequestConfig } from "axios";
import asyncToGenerator from "@babel/runtime/helpers/asyncToGenerator";
import babelRegenerator from "@babel/runtime/helpers/regenerator";
import babelTypeof from "@babel/runtime/helpers/typeof";
import { Buffer } from "buffer";
import CryptoJs from "crypto-js";
import * as pako from "pako";
import { URL, URLSearchParams } from "react-native-url-polyfill";
import DeviceInfo from "react-native-device-info";
import { devLog } from "@/utils/log";
import { rsaEncrypt } from "./rsa";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";
import {
    ILxRequestHandler,
    ILxRequestPayload,
    ILxQuality,
    ILxSourceInitSources,
    ILxSourceMetadata,
    ILxSourceRuntime,
} from "./types";

const EVENT_NAMES = {
    inited: "inited",
    request: "request",
    updateAlert: "updateAlert",
} as const;

const supportedBufferEncodings = new Set(["base64", "hex", "utf8", "utf-8"]);
const supportedActions = new Set(["musicUrl", "lyric", "pic"]);
const supportedSourceKeys = ["kw", "kg", "tx", "wy", "mg", "local"] as const;

/** 等待自定义源发送 inited 事件的超时时间（毫秒） */
const INITED_TIMEOUT_MS = 10_000;

function regeneratorDefine(target: any, key?: string, value?: any, notEnumerable?: boolean) {
    let defineProperty: typeof Object.defineProperty | null = Object.defineProperty;
    try {
        defineProperty({}, "", {});
    } catch {
        defineProperty = null;
    }

    function defineInvoke(methodName: string, arg: number) {
        regeneratorDefine(target, methodName, function(this: any, payload: any) {
            return this._invoke(methodName, arg, payload);
        });
    }

    if (key) {
        if (defineProperty) {
            defineProperty(target, key, {
                value,
                enumerable: !notEnumerable,
                configurable: !notEnumerable,
                writable: !notEnumerable,
            });
        } else {
            target[key] = value;
        }
    } else {
        defineInvoke("next", 0);
        defineInvoke("throw", 1);
        defineInvoke("return", 2);
    }
}

const regeneratorRuntimeCompat = babelRegenerator();

function asyncGeneratorStep(
    generator: any,
    resolve: (value: any) => void,
    reject: (error: any) => void,
    next: (value: any) => void,
    throwError: (error: any) => void,
    key: "next" | "throw",
    arg: any,
) {
    let info;
    let value;
    try {
        info = generator[key](arg);
        value = info.value;
    } catch (e) {
        reject(e);
        return;
    }
    if (info.done) {
        resolve(value);
    } else {
        Promise.resolve(value).then(next, throwError);
    }
}

const babelHelpers = {
    _regenerator: babelRegenerator,
    _regeneratorRuntime: regeneratorRuntimeCompat,
    regeneratorRuntime: regeneratorRuntimeCompat,
    _regeneratorDefine: regeneratorDefine,
    _regeneratorDefine2: regeneratorDefine,
    _asyncToGenerator: asyncToGenerator,
    asyncGeneratorStep,
    _typeof: babelTypeof,
};

function normalizeBufferEncoding(format?: string) {
    const safeFormat = format?.toLowerCase() || "utf8";
    if (!supportedBufferEncodings.has(safeFormat)) {
        return "utf8";
    }
    return safeFormat === "utf-8" ? "utf8" : safeFormat;
}

function randomBytes(size: number) {
    const bytes: number[] = [];
    for (let i = 0; i < size; i++) {
        bytes.push(Math.floor(Math.random() * 256));
    }
    return Buffer.from(bytes);
}

function wordArrayToBuffer(wordArray: CryptoJs.lib.WordArray) {
    return Buffer.from(wordArray.toString(CryptoJs.enc.Hex), "hex");
}

/** 把 Buffer/Uint8Array/字符串安全地转成 CryptoJS WordArray（二进制按字节，不做 UTF-8 强转） */
function toWordArray(input: any): CryptoJs.lib.WordArray {
    if (Buffer.isBuffer(input)) {
        return CryptoJs.enc.Hex.parse(input.toString("hex"));
    }
    if (input instanceof Uint8Array) {
        return CryptoJs.enc.Hex.parse(Buffer.from(input).toString("hex"));
    }
    return CryptoJs.enc.Utf8.parse(String(input ?? ""));
}

/** 把 Buffer/Uint8Array/字符串转成 Uint8Array（供 pako 使用） */
function toUint8Array(input: any): Uint8Array {
    if (input instanceof Uint8Array) {
        return input;
    }
    if (Buffer.isBuffer(input)) {
        return input;
    }
    return Buffer.from(String(input ?? ""));
}

function createCryptoUtils() {
    return {
        md5(raw: any) {
            const input =
                Buffer.isBuffer(raw) || raw instanceof Uint8Array
                    ? toWordArray(raw)
                    : String(raw ?? "");
            return CryptoJs.MD5(input).toString(CryptoJs.enc.Hex);
        },
        randomBytes(size: number) {
            return randomBytes(size);
        },
        aesEncrypt(raw: any, mode: string, key: any, iv?: any) {
            const normalizedMode = String(mode ?? "").toLowerCase();
            // key/iv/data 可能是二进制 Buffer，按字节转换，避免 UTF-8 强转破坏密钥
            const keyWordArray = toWordArray(key);
            const rawWordArray = toWordArray(raw);
            const options: any = {
                padding: CryptoJs.pad.Pkcs7,
            };

            if (normalizedMode === "aes-128-cbc") {
                options.mode = CryptoJs.mode.CBC;
                options.iv = toWordArray(iv);
            } else if (normalizedMode === "aes-128-ecb") {
                options.mode = CryptoJs.mode.ECB;
            } else {
                throw new Error(`Unsupported AES mode: ${mode}`);
            }

            return wordArrayToBuffer(
                CryptoJs.AES.encrypt(rawWordArray, keyWordArray, options).ciphertext,
            );
        },
        rsaEncrypt(raw: any, key: any) {
            const dataBuffer =
                Buffer.isBuffer(raw) || raw instanceof Uint8Array
                    ? Buffer.from(raw)
                    : Buffer.from(String(raw ?? ""));
            return rsaEncrypt(dataBuffer, String(key ?? ""));
        },
    };
}

function createUtils() {
    return {
        buffer: {
            from(raw: any, format?: string) {
                return Buffer.from(raw, normalizeBufferEncoding(format) as BufferEncoding);
            },
            bufToString(raw: any, format?: string) {
                return Buffer.from(raw).toString(
                    normalizeBufferEncoding(format) as BufferEncoding,
                );
            },
        },
        crypto: createCryptoUtils(),
        zlib: {
            // 同步实现，返回 Buffer（与 node zlib 的 *Sync 行为一致；
            // 脚本里 `const out = zlib.inflate(buf)` 或 `await zlib.inflate(buf)` 均可用）。
            inflate(data: any) {
                return Buffer.from(pako.inflate(toUint8Array(data)));
            },
            deflate(data: any) {
                return Buffer.from(pako.deflate(toUint8Array(data)));
            },
        },
    };
}

function toAxiosConfig(options?: any): AxiosRequestConfig {
    const method = options?.method ? String(options.method).toUpperCase() : "GET";
    const config: AxiosRequestConfig = {
        method,
        headers: options?.headers,
        timeout: Number(options?.timeout) || 15_000,
    };

    if (options?.body !== undefined) {
        config.data = options.body;
    } else if (options?.form !== undefined) {
        config.data = options.form;
        config.headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(config.headers ?? {}),
        };
    } else if (options?.formData !== undefined) {
        config.data = options.formData;
    }

    return config;
}

interface ILxHttpClient {
    (
        url: string,
        config: AxiosRequestConfig,
    ): Promise<{
        status: number;
        headers: unknown;
        data: unknown;
    }>;
}

export function createLxRequest(
    httpClient: ILxHttpClient,
) {
    return function lxRequest(
        url: string,
        options?: any,
        callback?: (err: any, resp?: any, body?: any) => void,
    ) {
        const controller = new AbortController();
        httpClient(url, {
            ...toAxiosConfig(options),
            signal: controller.signal,
            // lx 的 request 是 request.js 风格：任何 HTTP 状态码都回调 resp，
            // 让脚本自行根据 resp.statusCode / resp.body 处理（如 403 重试、读错误体）。
            // axios 默认对非 2xx 抛错，会丢掉 resp，必须放开。
            validateStatus: () => true,
        })
            .then(resp => {
                callback?.(null, {
                    statusCode: resp.status,
                    status: resp.status,
                    headers: resp.headers,
                    body: resp.data,
                }, resp.data);
            })
            .catch(err => {
                callback?.(err);
            });

        return () => controller.abort();
    };
}

/**
 * LX 音源和普通插件同属第三方脚本，共用同一个明文开关。
 *
 * 这里用注入而不是直接 import appConfig：runtime.ts 目前不依赖 MMKV，
 * 直接引入会把存储层拖进这个模块的依赖图（并让 runtime 的单测无法加载）。
 * 由已经持有 Config 的 lxSource/index.ts 在导入时注册。
 */
let lxAllowInsecureHttp: () => boolean = () => false;

export function setLxAllowInsecureHttp(getter: () => boolean) {
    lxAllowInsecureHttp = getter;
}

const lxRequest = createLxRequest(createRestrictedHttpClient({
    allowHttp: () => lxAllowInsecureHttp(),
}));

function normalizeLxQuality(rawQuality: string): ILxQuality | null {
    const quality = String(rawQuality ?? "").trim().toLowerCase();
    if (!quality) {
        return null;
    }
    if (quality === "24bit" || quality === "hires" || quality === "master" || quality === "atmos") {
        return "flac24bit";
    }
    if (quality === "128k" || quality === "192k" || quality === "320k" || quality === "flac" || quality === "flac24bit") {
        return quality;
    }
    return null;
}

function normalizeLxQualities(rawQualities: any) {
    if (!Array.isArray(rawQualities)) {
        return [];
    }
    const seen = new Set<ILxQuality>();
    const qualities: ILxQuality[] = [];
    rawQualities.forEach(rawQuality => {
        const quality = normalizeLxQuality(rawQuality);
        if (quality && !seen.has(quality)) {
            seen.add(quality);
            qualities.push(quality);
        }
    });
    return qualities;
}

function normalizeSources(rawSources: any): ILxSourceInitSources {
    if (!rawSources || typeof rawSources !== "object") {
        return {};
    }

    const result: ILxSourceInitSources = {};
    supportedSourceKeys.forEach(key => {
        const rawSource = rawSources[key];
        if (!rawSource || typeof rawSource !== "object") {
            return;
        }
        result[key] = {
            name: rawSource.name,
            type: rawSource.type,
            actions: Array.isArray(rawSource.actions)
                ? rawSource.actions.filter((action: string) =>
                    supportedActions.has(action),
                )
                : [],
            qualitys: normalizeLxQualities(rawSource.qualitys),
        };
    });

    return result;
}

export function createRuntimeGlobal(lx: any) {
    const globalThisObject = Object.assign(Object.create(null), {
        lx,
        setTimeout,
        clearTimeout,
        console,
        URL,
        URLSearchParams,
        Buffer,
        process: {
            env: {},
        },
        exports: {},
        module: {
            exports: {},
        },
        DEV_ENABLE: false,
        UPDATE_ENABLE: false,
        API_URL: "",
        API_KEY: "",
        MUSIC_SOURCE: {},
        MUSIC_SOURCES: {},
        MUSIC_QUALITY: {},
        fetch: undefined,
        XMLHttpRequest: undefined,
        WebSocket: undefined,
        constructor: undefined,
        httpFetch: lxRequest,
        ...babelHelpers,
    }) as Record<string, any>;

    globalThisObject.window = globalThisObject;
    globalThisObject.self = globalThisObject;
    globalThisObject.global = globalThisObject;
    globalThisObject.globalThis = globalThisObject;
    return globalThisObject;
}

function normalizeMusicUrlResult(raw: any): IPlugin.IMediaSourceResult | null {
    if (!raw) {
        return null;
    }
    if (typeof raw === "string") {
        return {
            url: raw,
        };
    }
    if (typeof raw === "object") {
        const url = raw.url || raw.musicUrl || raw.src;
        if (!url) {
            return null;
        }
        const headers = raw.headers;
        return {
            url,
            headers,
            userAgent:
                raw.userAgent ??
                raw.userAgentString ??
                headers?.["user-agent"] ??
                headers?.["User-Agent"],
            quality: raw.quality ?? raw.type,
        };
    }
    return null;
}

function isValidIdentifier(name: string) {
    return /^[A-Za-z_$][\w$]*$/.test(name);
}

const runtimeParameterNames = new Set([
    "lx",
    "setTimeout",
    "clearTimeout",
    "console",
    "URL",
    "URLSearchParams",
    "Buffer",
    "process",
    "exports",
    "module",
    "window",
    "self",
    "global",
    "globalThis",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "_regenerator",
    "_regeneratorRuntime",
    "regeneratorRuntime",
    "_regeneratorDefine",
    "_regeneratorDefine2",
    "_asyncToGenerator",
    "asyncGeneratorStep",
    "_typeof",
]);

export function runScriptInRuntimeGlobal(
    script: string,
    globalThisObject: Record<string, any>,
) {
    const paramNames = Object.keys(globalThisObject).filter(name =>
        runtimeParameterNames.has(name) && isValidIdentifier(name),
    );
    const paramValues = paramNames.map(name => globalThisObject[name]);

    // Hermes does not support `with`, so expose only stable LX/browser-like
    // globals as parameters. Common script-local names such as API_URL or
    // MUSIC_QUALITY stay as globalThis properties to avoid top-level const
    // redeclaration conflicts in real LX custom sources.
    // eslint-disable-next-line no-new-func
    Function(...paramNames, script).apply(globalThisObject, paramValues);
}

export async function createLxSourceRuntime(
    script: string,
    metadata: ILxSourceMetadata,
): Promise<ILxSourceRuntime> {
    const handlers: Record<string, (...args: any[]) => any> = {};
    let sources: ILxSourceInitSources = {};

    // 脚本可能同步、也可能异步（拉取配置/密钥后）才发送 inited，
    // 因此用 promise 等待该事件，而不是在脚本同步执行完后立刻检查。
    let settleInited: (() => void) | undefined;
    let failInited: ((error: Error) => void) | undefined;
    let initedSettled = false;
    const initedPromise = new Promise<void>((resolve, reject) => {
        settleInited = () => {
            if (!initedSettled) {
                initedSettled = true;
                resolve();
            }
        };
        failInited = (error: Error) => {
            if (!initedSettled) {
                initedSettled = true;
                reject(error);
            }
        };
    });

    const lx = {
        version: DeviceInfo.getVersion(),
        env: "mobile",
        currentScriptInfo: {
            ...metadata,
            rawScript: script,
        },
        EVENT_NAMES,
        on(eventName: string, handler: (...args: any[]) => any) {
            handlers[eventName] = handler;
        },
        send(eventName: string, data: any) {
            if (eventName === EVENT_NAMES.inited) {
                if (data?.status === false) {
                    failInited?.(
                        new Error(
                            data?.errorMsg ||
                                "LX custom source reported init failure",
                        ),
                    );
                    return;
                }
                sources = normalizeSources(data?.sources);
                settleInited?.();
            } else if (eventName === EVENT_NAMES.updateAlert) {
                devLog("info", "LX custom source update alert", {
                    name: metadata.name,
                    log: data?.log,
                    updateUrl: data?.updateUrl,
                });
            }
        },
        request: lxRequest,
        utils: createUtils(),
    };

    const globalThisObject = createRuntimeGlobal(lx);
    runScriptInRuntimeGlobal(script, globalThisObject);

    // 等待 inited（带超时），以支持异步初始化的自定义源。
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error("LX custom source inited timeout"));
        }, INITED_TIMEOUT_MS);
    });
    try {
        await Promise.race([initedPromise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }

    const requestHandler = handlers[EVENT_NAMES.request] as ILxRequestHandler | undefined;
    if (!requestHandler) {
        throw new Error("LX custom source did not register request handler");
    }
    if (!Object.keys(sources).length) {
        throw new Error("LX custom source did not send inited sources");
    }

    return {
        metadata,
        sources,
        request: async (payload: ILxRequestPayload) => requestHandler(payload),
    };
}

export async function requestLxMusicUrl(
    runtime: ILxSourceRuntime,
    payload: ILxRequestPayload,
) {
    const rawResult = await runtime.request(payload);
    return normalizeMusicUrlResult(rawResult);
}
