import axios, { AxiosRequestConfig } from "axios";
import { Buffer } from "buffer";
import CryptoJs from "crypto-js";
import { URL, URLSearchParams } from "react-native-url-polyfill";
import DeviceInfo from "react-native-device-info";
import { devLog } from "@/utils/log";
import {
    ILxRequestHandler,
    ILxRequestPayload,
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

function createUnsupportedUtil(name: string) {
    return () => {
        throw new Error(`LX custom source util is not supported: ${name}`);
    };
}

function createCryptoUtils() {
    return {
        md5(raw: string) {
            return CryptoJs.MD5(raw).toString(CryptoJs.enc.Hex);
        },
        randomBytes(size: number) {
            return randomBytes(size);
        },
        aesEncrypt(raw: any, mode: string, key: any, iv?: any) {
            const normalizedMode = String(mode ?? "").toLowerCase();
            const keyWordArray = CryptoJs.enc.Utf8.parse(
                Buffer.isBuffer(key) ? key.toString("utf8") : String(key ?? ""),
            );
            const rawWordArray = CryptoJs.enc.Utf8.parse(
                Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? ""),
            );
            const options: any = {
                padding: CryptoJs.pad.Pkcs7,
            };

            if (normalizedMode === "aes-128-cbc") {
                options.mode = CryptoJs.mode.CBC;
                options.iv = CryptoJs.enc.Utf8.parse(
                    Buffer.isBuffer(iv) ? iv.toString("utf8") : String(iv ?? ""),
                );
            } else if (normalizedMode === "aes-128-ecb") {
                options.mode = CryptoJs.mode.ECB;
            } else {
                throw new Error(`Unsupported AES mode: ${mode}`);
            }

            return wordArrayToBuffer(
                CryptoJs.AES.encrypt(rawWordArray, keyWordArray, options).ciphertext,
            );
        },
        rsaEncrypt: createUnsupportedUtil("crypto.rsaEncrypt"),
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
            inflate: createUnsupportedUtil("zlib.inflate"),
            deflate: createUnsupportedUtil("zlib.deflate"),
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

function lxRequest(url: string, options?: any, callback?: (err: any, resp?: any, body?: any) => void) {
    const controller = new AbortController();
    axios(url, {
        ...toAxiosConfig(options),
        signal: controller.signal,
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
}

function normalizeSources(rawSources: any): ILxSourceInitSources {
    if (!rawSources || typeof rawSources !== "object") {
        return {};
    }

    const result: ILxSourceInitSources = {};
    (["kw", "kg", "tx", "wy", "mg", "local"] as const).forEach(key => {
        const rawSource = rawSources[key];
        if (!rawSource || typeof rawSource !== "object") {
            return;
        }
        result[key] = {
            name: rawSource.name,
            type: rawSource.type,
            actions: Array.isArray(rawSource.actions)
                ? rawSource.actions.filter((action: string) =>
                    ["musicUrl", "lyric", "pic"].includes(action),
                )
                : [],
            qualitys: Array.isArray(rawSource.qualitys)
                ? rawSource.qualitys.filter((quality: string) =>
                    ["128k", "320k", "flac", "flac24bit"].includes(quality),
                )
                : [],
        };
    });

    return result;
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

export async function createLxSourceRuntime(
    script: string,
    metadata: ILxSourceMetadata,
): Promise<ILxSourceRuntime> {
    const handlers: Record<string, (...args: any[]) => any> = {};
    let sources: ILxSourceInitSources = {};

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
                sources = normalizeSources(data?.sources);
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

    const globalThisObject = {
        lx,
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        Buffer,
    };

    // eslint-disable-next-line no-new-func
    Function(`
        'use strict';
        return function(globalThis, console, setTimeout, clearTimeout, URL, URLSearchParams, Buffer) {
            ${script}
        }
    `)()(globalThisObject, console, setTimeout, clearTimeout, URL, URLSearchParams, Buffer);

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
