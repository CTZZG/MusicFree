import {
    internalSerializeKey,
    localPluginPlatform,
} from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import Mp3Util from "@/native/mp3Util";
import { resolveLocalMusicArtwork } from "@/core/localMusicArtworkManager";
import delay from "@/utils/delay";
import { addFileScheme, getFileName } from "@/utils/fileUtils";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import {
    getLocalPath,
    getMediaUniqueKey,
    isSameMediaItem,
    resetMediaItem,
} from "@/utils/mediaUtils";
import {
    formatAuthUrl, formatPluginErrorMessage,
    getAnonymousStackLocation,
    getRemoteMediaTitle,
    isRemoteMediaUrl,
    normalizeLocalFilePath,
} from "./plugin.utils";
import notImplementedFunction from "@/utils/notImplementedFunction.ts";
import axios from "axios";
import bigInt from "big-integer";
import * as cheerio from "cheerio";
import { satisfies } from "compare-versions";
import CryptoJs from "crypto-js";
import dayjs from "dayjs";
import he from "he";
import { produce } from "immer";
import { nanoid } from "nanoid";
import objectPath from "object-path";
import qs from "qs";
import { default as DeviceInfo, default as deviceInfoModule } from "react-native-device-info";
import RNFS, { exists, readFile, stat, writeFile } from "react-native-fs";
import { URL, URLSearchParams } from "react-native-url-polyfill";
import * as webdav from "webdav";
import * as pako from "pako";
import { Buffer } from "buffer";
import iconvLite from "iconv-lite";
import { devLog, errorLog, trace } from "../../utils/log";
import Network from "../../utils/network";
import MediaCache from "../mediaCache";
import {
    lrcLibLyricPluginDefine,
    neteaseLyricPluginDefine,
} from "./builtinLyricPlugins";
import {
    recordPluginDiagnosticError,
    recordPluginDiagnosticMessage,
} from "./diagnostics";
import { resolvePluginLocalMediaSource } from "./localMediaSourcePolicy";
import { validatePluginMediaSourceUrl } from "./mediaSourcePolicy";
import _internalPluginMeta from "./meta";
import { IPluginManager } from "@/types/core/pluginManager";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import {
    convertLegacyQuality,
    convertToLegacyQuality,
    isLegacyQuality,
    normalizePluginMusicItem,
} from "@/utils/qualities";
import LxSource from "@/core/lxSource";
import {
    canReadResolvedSourceCache,
    canWriteResolvedSourceCache,
} from "@/utils/cacheControlPolicy";
import { PluginTextDecoder, PluginTextEncoder } from "./pluginTextCodec";
import {
    createPluginCapabilityContext,
    detectPluginCapabilities,
    type PluginCapability,
} from "./capabilityFirewall";
import { clearPluginStorageNamespace } from "./pluginStorage";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";
import Config from "@/core/appConfig";
import {
    isMediaHttpAllowed,
    isPluginInsecureHttpAllowed,
} from "@/utils/mediaHttpCompatibilityPolicy";
import { createPluginRuntimeGlobalValues } from "./pluginRuntimeGlobals";
import {
    classifyMediaSourceFailure,
    createMediaSourceFailure,
    createMediaSourceFailureResult,
    MediaSourceResolutionError,
    mediaSourceFailureFromPluginResult,
    type MediaSourceFailureContext,
} from "./mediaSourceFailure";
import {
    callGetMediaSourceWithLegacyFallback,
    normalizeMediaSourceResultWithFailure,
} from "./mediaSourceResolution";
import {
    createResolvedMediaSourceCacheEntry,
    readResolvedMediaSourceCache,
} from "./resolvedMediaSourceCache";

const sha256 = CryptoJs.SHA256;
const pluginAssetHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 2 * 1024 * 1024,
    maxTimeoutMs: 3_000,
});

const deprecatedCookieManager = {
    get: notImplementedFunction,
    set: notImplementedFunction,
    flush: notImplementedFunction,
};

const pluginStorageStore = getOrCreateMMKV("plugin-storage");

export function clearInstalledPluginStorage(platform: string) {
    return clearPluginStorageNamespace(pluginStorageStore, platform);
}
const safePackages: Record<string, any> = {
    // 真实 axios，与上游官方一致。受限 HTTP 客户端的强制 HTTPS 等约束会让
    // 大量官方可用的插件直接失效，而插件的价值就在兼容性；传输层的 SSRF
    // 防护由原生 PublicHttpsNetworkPolicy 的 Dns 过滤器兜底。
    axios,
    cheerio,
    "crypto-js": CryptoJs,
    dayjs,
    "big-integer": bigInt,
    qs,
    he,
    "@react-native-cookies/cookies": deprecatedCookieManager,
    pako,
    buffer: { Buffer },
    "iconv-lite": iconvLite,
};

function ensurePluginRuntimePolyfills() {
    const promiseCtor = Promise as any;
    if (!promiseCtor.allSettled) {
        promiseCtor.allSettled = function allSettled(promises: Promise<any>[]) {
            return Promise.all(
                promises.map(promise =>
                    Promise.resolve(promise).then(
                        value => ({ status: "fulfilled", value }),
                        reason => ({ status: "rejected", reason }),
                    ),
                ),
            );
        };
    }

    if (!(Array.prototype as any).flatMap) {
        // eslint-disable-next-line no-extend-native
        Object.defineProperty(Array.prototype, "flatMap", {
            configurable: true,
            writable: true,
            value(callback: (...args: any[]) => any, thisArg?: any) {
                return Array.prototype.concat.apply(
                    [],
                    this.map(callback, thisArg),
                );
            },
        });
    }
}

ensurePluginRuntimePolyfills();

const _consoleBind = function (
    method: "log" | "error" | "info" | "warn",
    ...args: any
) {
    const fn = console[method];
    if (fn) {
        fn(...args);
        devLog(method, ...args);
    }
};

const _console = {
    log: _consoleBind.bind(null, "log"),
    warn: _consoleBind.bind(null, "warn"),
    info: _consoleBind.bind(null, "info"),
    error: _consoleBind.bind(null, "error"),
};

const appVersion = deviceInfoModule.getVersion();


function normalizeResultItem<T extends Partial<IMusic.IMusicItem>>(item: T) {
    Object.assign(item, normalizePluginMusicItem(item));
    return item;
}

export enum PluginState {
    // 初始化
    Initializing,
    // 加载中
    Loading,
    // 已加载
    Mounted,
    // 出现错误
    Error
}

export enum PluginErrorReason {
    // 版本不匹配
    VersionNotMatch,
    // 无法解析
    CannotParse,
}


export interface ILazyProps {
    name: string;
    hash: string;
    path: string;
    supportedMethods?: string[];
    loadFuncCode?: () => Promise<string>;
    instance?: IPlugin.IPluginDefine;
    runtimeCapabilities?: PluginCapability[];
}

export interface IPluginRuntimeOptions {
    grantedCapabilities?: Iterable<PluginCapability>;
    legacyInstalled?: boolean;
}

class PluginMethodsWrapper implements IPlugin.IPluginInstanceMethods {
    private plugin: Plugin;
    private ensurePluginIsMounted: () => Promise<void>;

    constructor(plugin: Plugin, ensurePluginIsMounted: () => Promise<void>) {
        this.plugin = plugin;
        this.ensurePluginIsMounted = ensurePluginIsMounted;
    }

    private recordError(
        method: keyof IPlugin.IPluginInstanceMethods | "mount",
        error: any,
        plugin: Plugin = this.plugin,
    ) {
        recordPluginDiagnosticError({
            pluginName: plugin.name || plugin.instance.platform || "unknown",
            pluginHash: plugin.hash,
            method,
            error,
            estimatedLocation: getAnonymousStackLocation(error?.stack),
        });
    }

    private async ensurePluginReady(
        method: keyof IPlugin.IPluginInstanceMethods,
    ) {
        try {
            await this.ensurePluginIsMounted();
        } catch (e) {
            this.recordError(method, e);
            throw e;
        }
    }

    private getMediaSourceFailureContext(
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey,
        plugin: Plugin = this.plugin,
    ): MediaSourceFailureContext {
        return {
            mediaKey: getMediaUniqueKey(musicItem),
            pluginName:
                plugin.name || plugin.instance.platform || "unknown",
            quality,
        };
    }

    private normalizeMediaSourceResult(
        mediaSourceResult: IPlugin.IMediaSourceResult,
    ) {
        const result = {
            ...mediaSourceResult,
            userAgent:
                mediaSourceResult.userAgent ??
                mediaSourceResult.headers?.["user-agent"] ??
                mediaSourceResult.headers?.["User-Agent"],
        } as IPlugin.IMediaSourceResult;

        if (!result.url) {
            return result;
        }

        const validation = validatePluginMediaSourceUrl(result.url, {
            allowHttp: isMediaHttpAllowed(Config),
        });
        if (!validation.ok) {
            const failure = classifyMediaSourceFailure(
                new Error(validation.reason),
            );
            throw new MediaSourceResolutionError(
                failure.code,
                validation.reason,
                {},
                failure.retryable,
            );
        }
        result.url = validation.url;

        const authFormattedResult = formatAuthUrl(result.url);
        if (authFormattedResult.auth) {
            result.url = authFormattedResult.url;
            result.headers = {
                ...(result.headers ?? {}),
                Authorization: authFormattedResult.auth,
            };
        }

        return result;
    }

    private normalizeMediaSourceResultOrFailure(
        mediaSourceResult: IPlugin.IMediaSourceResult,
        failureContext: MediaSourceFailureContext,
    ) {
        return normalizeMediaSourceResultWithFailure(
            mediaSourceResult,
            result => this.normalizeMediaSourceResult(result),
            failureContext,
        );
    }


    /** 搜索 */
    async search<T extends ICommon.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        await this.ensurePluginReady("search");
        if (!this.plugin.instance.search) {
            return {
                isEnd: true,
                data: [],
            };
        }

        try {
            const result =
                (await this.plugin.instance.search(query, page, type)) ?? {};
            if (Array.isArray(result.data)) {
                result.data.forEach(_ => {
                    normalizeResultItem(_);
                    resetMediaItem(_, this.plugin.name);
                });
                return {
                    isEnd: result.isEnd ?? true,
                    data: result.data,
                };
            }
            return {
                isEnd: true,
                data: [],
            };
        } catch (e) {
            this.recordError("search", e);
            throw e;
        }
    }

    /** 获取真实源 */
    async getMediaSource(
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey = "standard",
        retryCount = 1,
        notUpdateCache = false,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const normalizedQuality = convertLegacyQuality(quality);
        const legacyQuality = convertToLegacyQuality(normalizedQuality);
        const defaultFailureContext = this.getMediaSourceFailureContext(
            musicItem,
            normalizedQuality,
        );
        await this.ensurePluginReady("getMediaSource");
        // 1. 本地搜索 其实直接读mediameta就好了
        const localPathInMediaExtra = getMediaExtraProperty(musicItem, "localPath");
        const localPath = getLocalPath(musicItem);
        const normalizedLocalPath =
            localPath && !localPath.startsWith("content://")
                ? normalizeLocalFilePath(localPath)
                : localPath;
        const normalizedLocalPathExists =
            normalizedLocalPath && !normalizedLocalPath.startsWith("content://")
                ? await exists(normalizedLocalPath)
                : false;
        const localSourceResolution = resolvePluginLocalMediaSource({
            platform: musicItem.platform,
            localPluginPlatform,
            url: musicItem.url,
            localPath,
            localPathInMediaExtra,
            normalizedLocalPath,
            normalizedLocalPathExists,
        });

        if (localSourceResolution.type === "remote") {
            trace("网络音频播放");
            return this.normalizeMediaSourceResultOrFailure(
                {
                    url: localSourceResolution.url,
                },
                defaultFailureContext,
            );
        }
        if (localSourceResolution.type === "local") {
            trace("本地播放", {
                sourceType: localSourceResolution.url.startsWith("content://")
                    ? "content"
                    : "file",
            });
            if (localSourceResolution.patchLocalPath !== undefined) {
                // 修正一下本地数据
                patchMediaExtra(musicItem, {
                    localPath: localSourceResolution.patchLocalPath,
                });

            }
            return {
                url: localSourceResolution.url,
            };
        }
        if (localSourceResolution.type === "clear-stale-local-path") {
            patchMediaExtra(musicItem, {
                localPath: undefined,
            });
        }

        if (localSourceResolution.type === "missing-local") {
            return createMediaSourceFailureResult(
                createMediaSourceFailure(
                    "unavailable",
                    defaultFailureContext,
                ),
            );
        }
        // 2. 缓存播放
        const mediaCache = MediaCache.getMediaCache(
            musicItem,
        ) as IMusic.IMusicItem | null;
        const pluginCacheControl = this.plugin.instance.cacheControl;
        const cachedMediaSource = mediaCache
            ? readResolvedMediaSourceCache(
                mediaCache,
                normalizedQuality,
                legacyQuality,
            )
            : null;
        if (
            cachedMediaSource?.url &&
            canReadResolvedSourceCache(pluginCacheControl, Network.isOffline)
        ) {
            trace("播放", "缓存播放");
            return this.normalizeMediaSourceResultOrFailure(
                cachedMediaSource,
                defaultFailureContext,
            );
        }
        // 3. 音源重定向
        const alternativePluginTarget = Plugin.pluginManager?.getAlternativePluginName(this.plugin);
        if (LxSource.isRedirectTarget(alternativePluginTarget)) {
            devLog("info", "设置了LX自定义源重定向");
            let lxMediaSourceResult: IPlugin.IMediaSourceResult | null;
            try {
                lxMediaSourceResult =
                    await LxSource.getMediaSourceByRedirectTarget(
                        alternativePluginTarget!,
                        musicItem,
                        normalizedQuality,
                    );
            } catch (error) {
                const failure = classifyMediaSourceFailure(
                    error,
                    defaultFailureContext,
                );
                if (retryCount > 0 && failure.retryable) {
                    await delay(150);
                    return this.getMediaSource(
                        musicItem,
                        quality,
                        --retryCount,
                        notUpdateCache,
                    );
                }
                this.recordError("getMediaSource", error);
                return createMediaSourceFailureResult(failure);
            }
            if (!lxMediaSourceResult?.url) {
                const failure = mediaSourceFailureFromPluginResult(
                    lxMediaSourceResult?.failure,
                    defaultFailureContext,
                );
                if (retryCount > 0 && failure.retryable) {
                    await delay(150);
                    return this.getMediaSource(
                        musicItem,
                        quality,
                        --retryCount,
                        notUpdateCache,
                    );
                }
                return createMediaSourceFailureResult(failure);
            }

            const result = this.normalizeMediaSourceResultOrFailure(
                lxMediaSourceResult,
                defaultFailureContext,
            );
            if (!result.url) {
                return result;
            }
            if (
                canWriteResolvedSourceCache(pluginCacheControl) &&
                !notUpdateCache
            ) {
                const cacheSource = createResolvedMediaSourceCacheEntry(
                    result,
                    normalizedQuality,
                );
                let realMusicItem = {
                    ...musicItem,
                    ...(mediaCache || {}),
                };
                realMusicItem.source = {
                    ...(realMusicItem.source || {}),
                    [normalizedQuality]: cacheSource,
                };

                MediaCache.setMediaCache(realMusicItem);
            }
            return result;
        }

        const alternativePlugin = Plugin.pluginManager?.getAlternativePlugin(this.plugin) as Plugin | null;
        const parserPlugin = alternativePlugin?.instance?.getMediaSource ? alternativePlugin : this.plugin;
        const failureContext = this.getMediaSourceFailureContext(
            musicItem,
            normalizedQuality,
            parserPlugin,
        );
        const qualityInfo =
            musicItem?.qualities?.[normalizedQuality] ??
            (legacyQuality ? musicItem?.qualities?.[legacyQuality] : undefined);
        const declaredSupportedQualities =
            parserPlugin.instance.supportedQualities ?? [];
        const normalizedSupportedQualities = new Set(
            declaredSupportedQualities.map(convertLegacyQuality),
        );
        if (
            normalizedSupportedQualities.size > 0 &&
            !normalizedSupportedQualities.has(normalizedQuality) &&
            !qualityInfo?.url
        ) {
            return createMediaSourceFailureResult(
                createMediaSourceFailure("unavailable", failureContext),
            );
        }

        if (alternativePlugin) {
            devLog("info", "设置了替代插件，实际使用的插件为", parserPlugin.name);
        }

        // 4. 插件解析
        if (!parserPlugin.instance.getMediaSource) {
            const directUrl = qualityInfo?.url ?? musicItem.url;
            if (!directUrl) {
                return createMediaSourceFailureResult(
                    createMediaSourceFailure("unavailable", failureContext),
                );
            }
            return this.normalizeMediaSourceResultOrFailure(
                {
                    url: directUrl,
                    headers: qualityInfo?.headers,
                    userAgent: qualityInfo?.userAgent,
                    ekey: qualityInfo?.ekey ?? musicItem.ekey,
                    cek: qualityInfo?.cek ?? musicItem.cek,
                },
                failureContext,
            );
        }
        try {
            const mediaSourceResult: IPlugin.IMediaSourceResult = (await callGetMediaSourceWithLegacyFallback(
                parserPlugin.instance.getMediaSource,
                musicItem,
                normalizedQuality,
                failureContext,
                declaredSupportedQualities.length === 0 ||
                    declaredSupportedQualities.some(isLegacyQuality),
            )) ?? {
                url: qualityInfo?.url,
                headers: qualityInfo?.headers,
                userAgent: qualityInfo?.userAgent,
                ekey: qualityInfo?.ekey,
                cek: qualityInfo?.cek,
            };
            const {
                url,
                headers,
                userAgent,
                ekey,
                cek,
                quality: resolvedQuality,
            } = mediaSourceResult;
            if (!url) {
                const failure = mediaSourceFailureFromPluginResult(
                    mediaSourceResult.failure,
                    failureContext,
                );
                throw new MediaSourceResolutionError(
                    failure.code,
                    "插件未返回播放地址",
                    failureContext,
                    failure.retryable,
                );
            }
            trace("播放", "插件播放");
            const result = this.normalizeMediaSourceResult({
                url,
                headers,
                userAgent,
                ekey,
                cek,
                quality: resolvedQuality ?? normalizedQuality,
            } as IPlugin.IMediaSourceResult);

            if (
                canWriteResolvedSourceCache(pluginCacheControl) &&
                !notUpdateCache
            ) {
                // 更新缓存
                const cacheSource = createResolvedMediaSourceCacheEntry(
                    result,
                    normalizedQuality,
                );
                let realMusicItem = {
                    ...musicItem,
                    ...(mediaCache || {}),
                };
                realMusicItem.source = {
                    ...(realMusicItem.source || {}),
                    [normalizedQuality]: cacheSource,
                };

                MediaCache.setMediaCache(realMusicItem);
            }
            return result;
        } catch (e: any) {
            const failure = classifyMediaSourceFailure(e, failureContext);
            if (retryCount > 0 && failure.retryable) {
                await delay(150);
                return this.getMediaSource(
                    musicItem,
                    quality,
                    --retryCount,
                    notUpdateCache,
                );
            }
            this.recordError("getMediaSource", e, parserPlugin);
            errorLog("获取真实源失败", e?.message);
            devLog("error", "获取真实源失败", e, e?.message);
            return createMediaSourceFailureResult(failure);
        }
    }

    /** 获取音乐详情 */
    async getMusicInfo(
        musicItem: ICommon.IMediaBase,
    ): Promise<Partial<IMusic.IMusicItem> | null> {
        await this.ensurePluginReady("getMusicInfo");
        if (!this.plugin.instance.getMusicInfo) {
            return null;
        }
        try {
            const result =
                (await this.plugin.instance.getMusicInfo(
                    resetMediaItem(musicItem, undefined, true),
                )) ?? null;
            return result ? normalizeResultItem(result) : null;
        } catch (e: any) {
            this.recordError("getMusicInfo", e);
            devLog("error", "获取音乐详情失败", e, e?.message);
            return null;
        }
    }

    /** 获取音乐详情页链接 */
    async getMusicDetailPageUrl(
        musicItem: IMusic.IMusicItemBase,
    ): Promise<string | null> {
        await this.ensurePluginReady("getMusicDetailPageUrl");
        if (!this.plugin.instance.getMusicDetailPageUrl) {
            return null;
        }
        try {
            return (
                (await this.plugin.instance.getMusicDetailPageUrl(
                    resetMediaItem(musicItem, undefined, true),
                )) ?? null
            );
        } catch (e: any) {
            this.recordError("getMusicDetailPageUrl", e);
            devLog("error", "获取音乐详情页链接失败", e, e?.message);
            return null;
        }
    }

    /**
     *
     * getLyric(musicItem) => {
     *      lyric: string;
     *      trans: string;
     * }
     *
     */
    /** 获取歌词 */
    async getLyric(
        originalMusicItem: IMusic.IMusicItemBase,
    ): Promise<ILyric.ILyricSource | null> {
        await this.ensurePluginReady("getLyric");
        // 1.额外存储的meta信息（关联歌词）
        const associatedLrc = getMediaExtraProperty(originalMusicItem, "associatedLrc");
        let musicItem: IMusic.IMusicItem;
        if (associatedLrc) {
            musicItem = associatedLrc as IMusic.IMusicItem;
        } else {
            musicItem = originalMusicItem as IMusic.IMusicItem;
        }
        const withSourceMeta = (
            source: ILyric.ILyricSource,
            fallbackType: NonNullable<ILyric.ILyricSource["sourceType"]>,
            pluginName = this.plugin.name,
        ): ILyric.ILyricSource => ({
            ...source,
            sourceType: associatedLrc
                ? "associated"
                : source.sourceType ?? fallbackType,
            sourcePluginName:
                associatedLrc?.platform ??
                source.sourcePluginName ??
                pluginName,
            sourceTitle:
                associatedLrc?.title ??
                source.sourceTitle ??
                musicItem.title,
        });

        const musicItemCache = MediaCache.getMediaCache(
            musicItem,
        ) as IMusic.IMusicItemCache | null;

        /** 原始歌词文本 */
        let rawLrc: string | null = musicItem.rawLrc || null;
        let translation: string | null = null;
        let romanization: string | null = null;

        // 2. 本地手动设置的歌词
        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash = CryptoJs.MD5(musicItem.id).toString(CryptoJs.enc.Hex);
        if (
            await RNFS.exists(
                pathConst.localLrcPath + platformHash + "/" + idHash + ".lrc",
            )
        ) {
            rawLrc = await RNFS.readFile(
                pathConst.localLrcPath + platformHash + "/" + idHash + ".lrc",
                "utf8",
            );

            if (
                await RNFS.exists(
                    pathConst.localLrcPath +
                    platformHash +
                    "/" +
                    idHash +
                    ".tran.lrc",
                )
            ) {
                translation =
                    (await RNFS.readFile(
                        pathConst.localLrcPath +
                        platformHash +
                        "/" +
                        idHash +
                        ".tran.lrc",
                        "utf8",
                    )) || null;
            }

            if (
                await RNFS.exists(
                    pathConst.localLrcPath +
                    platformHash +
                    "/" +
                    idHash +
                    ".roma.lrc",
                )
            ) {
                romanization =
                    (await RNFS.readFile(
                        pathConst.localLrcPath +
                        platformHash +
                        "/" +
                        idHash +
                        ".roma.lrc",
                        "utf8",
                    )) || null;
            }

            return withSourceMeta({
                rawLrc,
                translation: translation || undefined,
                romanization: romanization || undefined,
            }, "local");
        }

        // 2. 本地音乐优先读取内嵌歌词或同目录同名 .lrc
        const localFilePath = getLocalPath(originalMusicItem);
        if (localFilePath && !isRemoteMediaUrl(localFilePath)) {
            const res = await localFilePluginDefine!.getLyric!(originalMusicItem);
            if (res) {
                devLog("info", "本地文件歌词");
                return withSourceMeta(res, res.sourceType ?? "local");
            }
        }

        // 3. 缓存歌词 / 对象上本身的歌词
        if (musicItemCache?.lyric) {
            // 缓存的远程结果
            let cacheLyric: ILyric.ILyricSource | null =
                musicItemCache.lyric || null;
            // 缓存的本地结果
            let localLyric: ILyric.ILyricSource | null =
                musicItemCache.$localLyric || null;

            // 优先用缓存的结果
            if (cacheLyric.rawLrc || cacheLyric.translation || cacheLyric.romanization) {
                return withSourceMeta({
                    rawLrc: cacheLyric.rawLrc,
                    translation: cacheLyric.translation,
                    romanization: cacheLyric.romanization,
                }, "cache");
            }

            // 本地其实是缓存的路径
            if (localLyric) {
                let needRefetch = false;
                if (localLyric.rawLrc && (await exists(localLyric.rawLrc))) {
                    rawLrc = await readFile(localLyric.rawLrc, "utf8");
                } else if (localLyric.rawLrc) {
                    needRefetch = true;
                }
                if (
                    localLyric.translation &&
                    (await exists(localLyric.translation))
                ) {
                    translation = await readFile(
                        localLyric.translation,
                        "utf8",
                    );
                } else if (localLyric.translation) {
                    needRefetch = true;
                }
                if (
                    localLyric.romanization &&
                    (await exists(localLyric.romanization))
                ) {
                    romanization = await readFile(
                        localLyric.romanization,
                        "utf8",
                    );
                } else if (localLyric.romanization) {
                    needRefetch = true;
                }

                if (!needRefetch && (rawLrc || translation || romanization)) {
                    return withSourceMeta({
                        rawLrc: rawLrc || undefined,
                        translation: translation || undefined,
                        romanization: romanization || undefined,
                    }, "cache");
                }
            }
        }

        // 4. 无缓存歌词/无自带歌词/无本地歌词
        let lrcSource: ILyric.ILyricSource | null;
        if (isSameMediaItem(originalMusicItem, musicItem)) {
            lrcSource =
                (await this.plugin.instance
                    ?.getLyric?.(resetMediaItem(musicItem, undefined, true))
                    ?.catch(e => {
                        this.recordError("getLyric", e);
                        return null;
                    })) || null;
        } else {
            const targetPlugin = Plugin.pluginManager?.getByMedia(musicItem) as Plugin | undefined;
            lrcSource =
                (await targetPlugin
                    ?.instance?.getLyric?.(
                        resetMediaItem(musicItem, undefined, true),
                    )
                    ?.catch(e => {
                        this.recordError("getLyric", e, targetPlugin);
                        return null;
                    })) || null;
        }

        if (lrcSource) {
            rawLrc = lrcSource?.rawLrc || rawLrc;
            translation = lrcSource?.translation || null;
            romanization = lrcSource?.romanization || null;

            const deprecatedLrcUrl = lrcSource?.lrc || musicItem.lrc;

            // 本地的文件名
            let filename: string | undefined = `${pathConst.lrcCachePath}${nanoid()}.lrc`;
            let filenameTrans: string | undefined = `${pathConst.lrcCachePath}${nanoid()}.lrc`;
            let filenameRoma: string | undefined = `${pathConst.lrcCachePath}${nanoid()}.lrc`;

            // 旧版本兼容
            if (!(rawLrc || translation || romanization)) {
                if (deprecatedLrcUrl) {
                    rawLrc = (
                        await pluginAssetHttpClient
                            .get(deprecatedLrcUrl, { timeout: 3000 })
                            .catch(() => null)
                    )?.data;
                } else if (musicItem.rawLrc) {
                    rawLrc = musicItem.rawLrc;
                }
            }

            if (rawLrc) {
                await writeFile(filename, rawLrc, "utf8");
            } else {
                filename = undefined;
            }
            if (translation) {
                await writeFile(filenameTrans, translation, "utf8");
            } else {
                filenameTrans = undefined;
            }
            if (romanization) {
                await writeFile(filenameRoma, romanization, "utf8");
            } else {
                filenameRoma = undefined;
            }

            if (rawLrc || translation || romanization) {
                MediaCache.setMediaCache(
                    produce(musicItemCache || musicItem, draft => {
                        musicItemCache?.$localLyric?.rawLrc;
                        objectPath.set(draft, "$localLyric.rawLrc", filename);
                        objectPath.set(
                            draft,
                            "$localLyric.translation",
                            filenameTrans,
                        );
                        objectPath.set(
                            draft,
                            "$localLyric.romanization",
                            filenameRoma,
                        );
                        return draft;
                    }),
                );
                return withSourceMeta({
                    rawLrc: rawLrc || undefined,
                    translation: translation || undefined,
                    romanization: romanization || undefined,
                }, "plugin");
            }
        }

        devLog("warn", "无歌词");

        return null;
    }

    /** 获取逐字歌词 */
    async getWordByWordLyric(
        originalMusicItem: IMusic.IMusicItemBase,
    ): Promise<ILyric.ILyricSource | null> {
        await this.ensurePluginReady("getWordByWordLyric");
        const associatedLrc = getMediaExtraProperty(originalMusicItem, "associatedLrc");
        const musicItem = associatedLrc
            ? associatedLrc as IMusic.IMusicItem
            : originalMusicItem as IMusic.IMusicItem;

        if (!this.plugin.instance.getWordByWordLyric) {
            return null;
        }

        try {
            return (
                await this.plugin.instance.getWordByWordLyric(
                    resetMediaItem(musicItem, undefined, true),
                )
            ) ?? null;
        } catch (e: any) {
            this.recordError("getWordByWordLyric", e);
            devLog("error", "获取逐字歌词失败", e, e?.message);
            return null;
        }
    }


    /** 获取专辑信息 */
    async getAlbumInfo(
        albumItem: IAlbum.IAlbumItemBase,
        page: number = 1,
    ): Promise<IPlugin.IAlbumInfoResult | null> {
        await this.ensurePluginReady("getAlbumInfo");
        if (!this.plugin.instance.getAlbumInfo) {
            return {
                albumItem,
                musicList: (albumItem?.musicList ?? []).map(
                    resetMediaItem,
                    this.plugin.name,
                    true,
                ),
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance.getAlbumInfo(
                resetMediaItem(albumItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach(_ => {
                normalizeResultItem(_);
                resetMediaItem(_, this.plugin.name);
                _.album = albumItem.title;
            });

            if (page <= 1) {
                // 合并信息
                return {
                    albumItem: { ...albumItem, ...(result?.albumItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch (e: any) {
            this.recordError("getAlbumInfo", e);
            trace("获取专辑信息失败", e?.message);
            devLog("error", "获取专辑信息失败", e, e?.message);

            return null;
        }
    }

    /** 获取歌单信息 */
    async getMusicSheetInfo(
        sheetItem: IMusic.IMusicSheetItem,
        page: number = 1,
    ): Promise<IPlugin.ISheetInfoResult | null> {
        await this.ensurePluginReady("getMusicSheetInfo");
        if (!this.plugin.instance.getMusicSheetInfo) {
            return {
                sheetItem,
                musicList: sheetItem?.musicList ?? [],
                isEnd: true,
            };
        }
        try {
            const result = await this.plugin.instance?.getMusicSheetInfo?.(
                resetMediaItem(sheetItem, undefined, true),
                page,
            );
            if (!result) {
                throw new Error();
            }
            result?.musicList?.forEach(_ => {
                normalizeResultItem(_);
                resetMediaItem(_, this.plugin.name);
            });

            if (page <= 1) {
                // 合并信息
                return {
                    sheetItem: { ...sheetItem, ...(result?.sheetItem ?? {}) },
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            } else {
                return {
                    isEnd: result.isEnd === false ? false : true,
                    musicList: result.musicList,
                };
            }
        } catch (e: any) {
            this.recordError("getMusicSheetInfo", e);
            trace("获取歌单信息失败", e, e?.message);
            devLog("error", "获取歌单信息失败", e, e?.message);

            return null;
        }
    }

    /** 查询作者信息 */
    async getArtistWorks<T extends IArtist.ArtistMediaType>(
        artistItem: IArtist.IArtistItemBase,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T>> {
        await this.ensurePluginReady("getArtistWorks");
        if (!this.plugin.instance.getArtistWorks) {
            return {
                isEnd: true,
                data: [],
            };
        }
        try {
            const result = await this.plugin.instance.getArtistWorks(
                artistItem,
                page,
                type,
            );
            if (!result.data) {
                return {
                    isEnd: true,
                    data: [],
                };
            }
            result.data?.forEach(_ => {
                normalizeResultItem(_);
                resetMediaItem(_, this.plugin.name);
            });
            return {
                isEnd: result.isEnd ?? true,
                data: result.data,
            };
        } catch (e: any) {
            this.recordError("getArtistWorks", e);
            trace("查询作者信息失败", e?.message);
            devLog("error", "查询作者信息失败", e, e?.message);

            throw e;
        }
    }

    /** 导入歌单 */
    async importMusicSheet(urlLike: string): Promise<IMusic.IMusicItem[]> {
        await this.ensurePluginReady("importMusicSheet");
        try {
            const result =
                (await this.plugin.instance?.importMusicSheet?.(urlLike)) ?? [];
            result.forEach(_ => {
                normalizeResultItem(_);
                resetMediaItem(_, this.plugin.name);
            });
            return result;
        } catch (e: any) {
            this.recordError("importMusicSheet", e);
            console.log(e);
            devLog("error", "导入歌单失败", e, e?.message);

            return [];
        }
    }

    /** 导入单曲 */
    async importMusicItem(urlLike: string): Promise<IMusic.IMusicItem | null> {
        await this.ensurePluginReady("importMusicItem");
        try {
            const result = await this.plugin.instance?.importMusicItem?.(
                urlLike,
            );
            if (!result) {
                throw new Error();
            }
            normalizeResultItem(result);
            resetMediaItem(result, this.plugin.name);
            return result;
        } catch (e: any) {
            this.recordError("importMusicItem", e);
            devLog("error", "导入单曲失败", e, e?.message);

            return null;
        }
    }

    /** 获取榜单 */
    async getTopLists(): Promise<IMusic.IMusicSheetGroupItem[]> {
        await this.ensurePluginReady("getTopLists");
        try {
            const result = await this.plugin.instance?.getTopLists?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch (e: any) {
            this.recordError("getTopLists", e);
            devLog("error", "获取榜单失败", e, e?.message);
            return [];
        }
    }

    /** 获取榜单详情 */
    async getTopListDetail(
        topListItem: IMusic.IMusicSheetItemBase,
        page: number,
    ): Promise<IPlugin.ITopListInfoResult> {
        await this.ensurePluginReady("getTopListDetail");
        try {
            const result = await this.plugin.instance?.getTopListDetail?.(
                topListItem,
                page,
            );
            if (!result) {
                throw new Error();
            }
            if (result.musicList) {
                result.musicList.forEach(_ => {
                    normalizeResultItem(_);
                    resetMediaItem(_, this.plugin.name);
                });
            } else {
                result.musicList = [];
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            return result;
        } catch (e) {
            this.recordError("getTopListDetail", e);
            throw e;
        }
    }

    /** 获取推荐歌单的tag */
    async getRecommendSheetTags(): Promise<IPlugin.IGetRecommendSheetTagsResult> {
        await this.ensurePluginReady("getRecommendSheetTags");
        try {
            const result =
                await this.plugin.instance?.getRecommendSheetTags?.();
            if (!result) {
                throw new Error();
            }
            return result;
        } catch (e: any) {
            this.recordError("getRecommendSheetTags", e);
            devLog("error", "获取推荐歌单失败", e, e?.message);
            return {
                data: [],
            };
        }
    }

    /** 获取某个tag的推荐歌单 */
    async getRecommendSheetsByTag(
        tagItem: ICommon.IUnique,
        page?: number,
    ): Promise<ICommon.PaginationResponse<IMusic.IMusicSheetItemBase>> {
        await this.ensurePluginReady("getRecommendSheetsByTag");
        try {
            const result =
                await this.plugin.instance?.getRecommendSheetsByTag?.(
                    tagItem,
                    page ?? 1,
                );
            if (!result) {
                throw new Error();
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            if (!result.data) {
                result.data = [];
            }
            result.data.forEach(item => {
                normalizeResultItem(item);
                resetMediaItem(item, this.plugin.name);
            });

            return result;
        } catch (e: any) {
            this.recordError("getRecommendSheetsByTag", e);
            devLog("error", "获取推荐歌单详情失败", e, e?.message);
            return {
                isEnd: true,
                data: [],
            };
        }
    }

    /** 同步歌单 */
    async syncMusicSheet(sheetItem: IMusic.IMusicSheetItem): Promise<boolean> {
        await this.ensurePluginReady("syncMusicSheet");
        if (!this.plugin.instance.syncMusicSheet) {
            return false;
        }
        try {
            return (await this.plugin.instance.syncMusicSheet(sheetItem)) ?? false;
        } catch (e: any) {
            this.recordError("syncMusicSheet", e);
            devLog("error", "同步歌单失败", e, e?.message);
            return false;
        }
    }

    async onPlaybackStateChange(_playbackState: any) {

    }

    async getMusicComments(
        musicItem: IMusic.IMusicItem,
        page?: number
    ): Promise<ICommon.PaginationResponse<IMedia.IComment>> {
        await this.ensurePluginReady("getMusicComments");
        try {
            const result = await this.plugin.instance?.getMusicComments?.(
                musicItem,
                page ?? 1,
            );
            if (!result) {
                throw new Error();
            }
            if (result.isEnd !== false) {
                result.isEnd = true;
            }
            if (!result.data) {
                result.data = [];
            }

            return result;
        } catch (e) {
            this.recordError("getMusicComments", e);
            throw e;
        }
    }
}

//#region 插件类
export class Plugin {
    /** 插件名 */
    public name: string = "";
    /** 插件的hash，作为唯一id */
    public hash: string = "";
    /** 插件状态：激活、关闭、错误 */
    public state: PluginState = PluginState.Initializing;
    /** 插件出错时的原因 */
    public errorReason?: PluginErrorReason;
    /** 插件解析或初始化失败时的原始错误信息 */
    public errorMessage?: string;
    /** 插件的实例 */
    public instance: IPlugin.IPluginDefine = { platform: "" };
    /** 插件路径 */
    public path: string = "";
    /** 插件方法，内部进行标准化和校验 */
    public methods!: IPlugin.IPluginInstanceMethods;

    public supportedMethods: Set<keyof IPlugin.IPluginInstanceMethods> = new Set();
    /** 受限运行时中插件请求的高风险能力。 */
    public runtimeCapabilities: Set<PluginCapability> = new Set();

    private lazyProps: ILazyProps | null = null;
    private runtimeOptions: IPluginRuntimeOptions;
    private mountingPromise?: Promise<void>;

    static pluginManager: IPluginManager;

    static injectDependencies(
        pluginManager: IPluginManager,
    ) {
        Plugin.pluginManager = pluginManager;
    }

    constructor(
        funcCode: string | (() => IPlugin.IPluginDefine) | null,
        pluginPath: string,
        lazyProps: ILazyProps | null = null,
        runtimeOptions: IPluginRuntimeOptions = {},
    ) {
        this.lazyProps = lazyProps;
        this.runtimeOptions = runtimeOptions;
        if (!lazyProps) {
            // 如果没有懒加载，直接挂载并初始化
            this.mountPlugin(funcCode!, pluginPath);
            this.methods = new PluginMethodsWrapper(this, async () => { });
        } else {
            // 使用懒加载参数初始化
            this.name = lazyProps.name;
            this.hash = lazyProps.hash;
            this.path = lazyProps.path;
            this.instance = lazyProps.instance ?? {
                platform: lazyProps.name,
            };
            this.supportedMethods = new Set((lazyProps.supportedMethods ?? []) as any);
            this.runtimeCapabilities = new Set(
                lazyProps.runtimeCapabilities ?? [],
            );
            // 初始化方法，但实际调用时会先挂载插件
            this.methods = new PluginMethodsWrapper(this, this.ensureMounted.bind(this));
        }
    }

    async ensureMounted() {
        if ((this.state === PluginState.Initializing) && this.lazyProps) {
            this.mountingPromise ??= this.mountLazyPlugin();
        }

        if (this.mountingPromise) {
            try {
                await this.mountingPromise;
            } finally {
                this.mountingPromise = undefined;
            }
        }

        if (this.state === PluginState.Error) {
            throw new Error(this.errorMessage || "插件加载失败");
        }
    }

    private async mountLazyPlugin() {
        if (!this.lazyProps) {
            return;
        }

        this.state = PluginState.Loading;
        // 懒加载
        const loadFuncCode = this.lazyProps.loadFuncCode ?? (() => "");
        try {
            const funcCode = await loadFuncCode();
            this.mountPlugin(funcCode, this.lazyProps.path);
        } catch (e: any) {
            this.state = PluginState.Error;
            this.errorMessage = formatPluginErrorMessage(e);
            this.errorReason = this.errorReason ?? PluginErrorReason.CannotParse;
            recordPluginDiagnosticError({
                pluginName: this.name || this.instance.platform || "unknown",
                pluginHash: this.hash,
                method: "mount",
                error: e,
                estimatedLocation: getAnonymousStackLocation(e?.stack),
            });
        }
    }

    private mountPlugin(
        funcCode: string | (() => IPlugin.IPluginDefine),
        pluginPath: string) {
        this.state = PluginState.Loading;
        let _instance: IPlugin.IPluginDefine;
        let capabilityContext:
            | ReturnType<typeof createPluginCapabilityContext>
            | undefined;
        let sourceHash = "";

        const _module: any = { exports: {} };
        try {
            if (typeof funcCode === "string") {
                sourceHash = sha256(funcCode).toString();
                const requestedCapabilities =
                    detectPluginCapabilities(funcCode);
                this.runtimeCapabilities = new Set(requestedCapabilities);
                const grantedCapabilities =
                    this.runtimeOptions.legacyInstalled
                        ? requestedCapabilities
                        : this.runtimeOptions.grantedCapabilities;
                capabilityContext = createPluginCapabilityContext({
                    provisionalIdentity: sourceHash,
                    grantedCapabilities,
                    safePackages,
                    storageStore: pluginStorageStore,
                    webdavModule: webdav,
                    // 绝大多数现存插件的榜单/歌单/封面接口仍是 http://，
                    // 一律拒绝会直接打断这些功能，而对恶意插件毫无约束
                    // （插件代码本就在同一 JS realm 内执行）。因此明文由
                    // 用户显式开关控制；私网/环回/内嵌凭据仍然始终拒绝。
                    httpOptions: {
                        allowHttp: () => isPluginInsecureHttpAllowed(Config),
                    },
                    onAudit: event => {
                        recordPluginDiagnosticMessage({
                            pluginName:
                                this.name ||
                                this.instance.platform ||
                                "unknown",
                            pluginHash:
                                this.hash ||
                                sourceHash,
                            method: "capability",
                            message: [
                                `outcome=${event.outcome}`,
                                event.capability
                                    ? `capability=${event.capability}`
                                    : "",
                                event.moduleName
                                    ? `module=${event.moduleName}`
                                    : "",
                                `reason=${event.reason}`,
                            ].filter(Boolean).join("; "),
                        });
                    },
                });
                // 插件的环境变量
                const env = {
                    getUserVariables: () => {
                        return (
                            _internalPluginMeta.getUserVariables(this.name)
                        );
                    },
                    get userVariables() {
                        return this.getUserVariables() ?? {};
                    },
                    appVersion,
                    os: "android",
                    lang: "zh-CN",
                };
                const _process = {
                    platform: "android",
                    version: appVersion,
                    env,
                };

                // eslint-disable-next-line no-new-func
                _instance = Function(`
                    'use strict';
                    return function(require, __musicfree_require, module, exports, console, env, URL, URLSearchParams, process, TextDecoder, TextEncoder, Buffer, fetch, XMLHttpRequest, WebSocket, globalThis, window, self, global) {
                        // 插件代码必须包在内层函数里：很多插件顶层会写
                        // const { Buffer } = require("buffer") 之类的声明，
                        // 若与注入的参数同层会直接 SyntaxError（重复声明）
                        return (function() {
                            ${funcCode}
                        })();
                    }
                `)()(
                    capabilityContext.require,
                    capabilityContext.require,
                    _module,
                    _module.exports,
                    _console,
                    env,
                    URL,
                    URLSearchParams,
                    _process,
                    PluginTextDecoder,
                    PluginTextEncoder,
                    Buffer,
                    ...createPluginRuntimeGlobalValues(),
                );
                if (_module.exports.default) {
                    _instance = _module.exports
                        .default as IPlugin.IPluginInstance;
                } else {
                    _instance = _module.exports as IPlugin.IPluginInstance;
                }
            } else {
                _instance = funcCode();
            }
            // 插件初始化后的一些操作
            if (Array.isArray(_instance.userVariables)) {
                _instance.userVariables = _instance.userVariables.filter(
                    it => it?.key,
                );
            }
            this.checkValid(_instance);
            if (capabilityContext) {
                const migration = capabilityContext.bindIdentity(
                    _instance.platform,
                );
                if (migration.quarantinedLegacyEntries > 0) {
                    recordPluginDiagnosticMessage({
                        pluginName: _instance.platform,
                        pluginHash: sourceHash,
                        method: "storage-migration",
                        message:
                            `quarantinedLegacyEntries=${migration.quarantinedLegacyEntries}`,
                    });
                }
            }
        } catch (e: any) {
            this.state = PluginState.Error;
            this.errorReason = e?.errorReason ?? PluginErrorReason.CannotParse;
            this.errorMessage = formatPluginErrorMessage(e);
            recordPluginDiagnosticError({
                pluginName: this.name || e?.instance?.platform || "unknown",
                pluginHash: this.hash,
                method: "mount",
                error: e,
                estimatedLocation: getAnonymousStackLocation(e?.stack),
            });

            errorLog(`${pluginPath}插件无法解析 `, {
                errorReason: this.errorReason,
                message: this.errorMessage,
                stack: e?.stack,
            });
            _instance = e?.instance ?? {
                platform: "",
                appVersion: "",
                async getMediaSource() {
                    return null;
                },
                async search() {
                    return {};
                },
                async getAlbumInfo() {
                    return null;
                },
            };
        }

        this.instance = _instance;
        this.path = pluginPath;
        this.name = _instance.platform;
        this.supportedMethods = new Set(Object.keys(_instance).filter(
            key => typeof (_instance[key]) === "function",
        ) as any);

        // 检测name & 计算hash
        if (
            this.name === "" ||
            !this.name
        ) {
            this.hash = "";
            this.state = PluginState.Error;
            this.errorReason = this.errorReason ?? PluginErrorReason.CannotParse;
        } else {
            if (typeof funcCode === "string") {
                this.hash = sha256(funcCode).toString();
            } else {
                this.hash = sha256(pluginPath + "@" + appVersion).toString();
            }
        }


        if (this.state !== PluginState.Error) {
            this.state = PluginState.Mounted;
        }
    }

    private checkValid(_instance: IPlugin.IPluginDefine) {
        /** 版本号校验 */
        if (
            _instance.appVersion &&
            !satisfies(DeviceInfo.getVersion(), _instance.appVersion)
        ) {
            const error = new Error(
                `插件要求应用版本 ${_instance.appVersion}，当前版本 ${DeviceInfo.getVersion()}`,
            ) as Error & {
                instance?: IPlugin.IPluginDefine;
                errorReason?: PluginErrorReason;
            };
            error.instance = _instance;
            error.errorReason = PluginErrorReason.VersionNotMatch;
            throw error;
        }
        return true;
    }
}


const localFilePluginDefine: IPlugin.IPluginDefine = {
    platform: localPluginPlatform,
    async getMusicInfo(musicBase) {
        const localPath = getLocalPath(musicBase);
        if (localPath && !isRemoteMediaUrl(localPath)) {
            // 与列表和播放器共用路径级缓存，避免同一文件重复提取封面。
            const coverImg = await resolveLocalMusicArtwork(musicBase);
            return {
                artwork: coverImg ?? "",
            };
        }
        return null;
    },
    async getLyric(musicBase) {
        const localPath = getLocalPath(musicBase);
        let rawLrc: string | null = null;
        if (localPath && !isRemoteMediaUrl(localPath)) {
            const normalizedLocalPath = normalizeLocalFilePath(localPath);
            // 读取内嵌歌词
            try {
                rawLrc = await Mp3Util.getLyric(normalizedLocalPath);
            } catch (e) {
                console.log("读取内嵌歌词失败", e);
            }
            if (!rawLrc) {
                // 读取配置歌词
                const lastDot = normalizedLocalPath.lastIndexOf(".");
                const lrcPath = normalizedLocalPath.slice(0, lastDot) + ".lrc";

                try {
                    if (await exists(lrcPath)) {
                        rawLrc = await readFile(lrcPath, "utf8");
                    }
                } catch { }
            }
        }

        return rawLrc
            ? {
                rawLrc,
                sourceType: "local",
                sourcePluginName: localPluginPlatform,
            }
            : null;
    },
    async importMusicItem(urlLike) { // 绝对路径
        if (isRemoteMediaUrl(urlLike)) {
            const remoteUrl = urlLike;
            const id = CryptoJs.MD5(remoteUrl).toString(CryptoJs.enc.Hex) || nanoid();
            return {
                id,
                platform: localPluginPlatform,
                title: getRemoteMediaTitle(remoteUrl),
                artist: "未知歌手",
                duration: 0,
                album: "未知专辑",
                artwork: "",
                url: remoteUrl,
            };
        }

        const localPath = urlLike.startsWith("content://")
            ? urlLike
            : normalizeLocalFilePath(urlLike);
        let meta: any = {};
        let id: string;

        try {
            meta = await Mp3Util.getBasicMeta(localPath);
        } catch (e: any) {
            trace("本地音乐元信息读取失败", {
                localPath,
                message: e?.message ?? String(e),
            });
        }

        try {
            const fileStat = await stat(localPath);
            id =
                CryptoJs.MD5(
                    fileStat.originalFilepath ?? fileStat.path ?? localPath,
                ).toString(
                    CryptoJs.enc.Hex,
                ) || nanoid();
        } catch {
            id = CryptoJs.MD5(localPath).toString(
                CryptoJs.enc.Hex,
            ) || nanoid();
        }

        return {
            id: id,
            platform: localPluginPlatform,
            title: meta?.title ?? getFileName(localPath),
            artist: meta?.artist ?? "未知歌手",
            duration: parseInt(meta?.duration ?? "0", 10) / 1000,
            album: meta?.album ?? "未知专辑",
            artwork: "",
            [internalSerializeKey]: {
                localPath,
            },
            url: localPath,
        };
    },
    async getMediaSource(musicItem) {
        const localPath = musicItem.$?.localPath || musicItem.url;
        return {
            url: localPath
                ? localPath.startsWith("content://") || isRemoteMediaUrl(localPath)
                    ? localPath
                    : addFileScheme(normalizeLocalFilePath(localPath))
                : undefined,
        };
    },

};

export const localFilePlugin = new Plugin(function () {
    return localFilePluginDefine;
}, "internal-plugin://local-file-plugin");

export const builtinLyricPlugins = [
    new Plugin(function () {
        return neteaseLyricPluginDefine;
    }, "internal-plugin://netease-lyric-plugin"),
    new Plugin(function () {
        return lrcLibLyricPluginDefine;
    }, "internal-plugin://lrclib-lyric-plugin"),
];
