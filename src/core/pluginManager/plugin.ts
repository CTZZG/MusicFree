import {
    CacheControl,
    internalSerializeKey,
    localPluginPlatform,
} from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import Mp3Util from "@/native/mp3Util";
import delay from "@/utils/delay";
import { addFileScheme, getFileName } from "@/utils/fileUtils";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { getLocalPath, isSameMediaItem, resetMediaItem } from "@/utils/mediaUtils";
import {
    formatAuthUrl,
    formatPluginErrorMessage,
    getAnonymousStackLocation,
    getRemoteMediaTitle,
    isRemoteMediaUrl,
    normalizeLocalFilePath,
    shouldReadLocalSystemMetadata,
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
import { devLog, errorLog, trace } from "../../utils/log";
import Network from "../../utils/network";
import MediaCache from "../mediaCache";
import {
    lrcLibLyricPluginDefine,
    neteaseLyricPluginDefine,
} from "./builtinLyricPlugins";
import { recordPluginDiagnosticError } from "./diagnostics";
import _internalPluginMeta from "./meta";
import { IPluginManager } from "@/types/core/pluginManager";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import {
    convertLegacyQuality,
    convertToLegacyQuality,
    normalizePluginMusicItem,
} from "@/utils/qualities";
import LxSource from "@/core/lxSource";


axios.defaults.timeout = 15000;
axios.interceptors.response.use((response) => {
    // 统一setcookie格式，nodejs环境是数组，移动端环境都放在第一个元素
    const setCookie = response.headers["set-cookie"];
    if (setCookie && setCookie.length === 1) {
        const splitedCookie = setCookie[0].split(",");
        response.headers["set-cookie"] = splitedCookie;
        response.headers["x-set-cookie"] = setCookie;
    }

    return response;
});

const sha256 = CryptoJs.SHA256;

const deprecatedCookieManager = {
    get: notImplementedFunction,
    set: notImplementedFunction,
    flush: notImplementedFunction,
};

const pluginStorageStore = getOrCreateMMKV("plugin-storage");
const pluginStorage = {
    async setItem(key: string, value: unknown) {
        pluginStorageStore.set(
            key,
            typeof value === "string" ? value : value == null ? "" : String(value),
        );
    },
    async getItem(key: string) {
        return pluginStorageStore.getString(key) ?? null;
    },
    async removeItem(key: string) {
        pluginStorageStore.delete(key);
    },
};

const packages: Record<string, any> = {
    cheerio,
    "crypto-js": CryptoJs,
    axios,
    dayjs,
    "big-integer": bigInt,
    qs,
    he,
    "@react-native-cookies/cookies": deprecatedCookieManager,
    webdav,
    "musicfree/storage": pluginStorage,
    pako,
    buffer: { Buffer },
};

const _require = (packageName: string) => {
    const pkg = packages[packageName];
    if (!pkg) {
        return null;
    }
    try {
        pkg.default = pkg;
        return pkg;
    } catch {
        if (typeof pkg === "function") {
            const wrapped = (...args: any[]) => pkg(...args);
            Object.assign(wrapped, pkg, { default: pkg });
            return wrapped;
        }
        return {
            ...pkg,
            default: pkg,
        };
    }
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

async function callGetMediaSourceWithLegacyFallback(
    getMediaSource: IPlugin.IPluginDefine["getMediaSource"],
    musicItem: IMusic.IMusicItemBase,
    quality: IMusic.IQualityKey,
) {
    if (!getMediaSource) {
        return null;
    }

    const normalizedQuality = convertLegacyQuality(quality);
    let result: IPlugin.IMediaSourceResult | null = null;
    let firstError: unknown;
    try {
        result = await getMediaSource(musicItem, normalizedQuality);
    } catch (e) {
        firstError = e;
    }
    if (result?.url) {
        return result;
    }

    const legacyQuality = convertToLegacyQuality(normalizedQuality);
    if (legacyQuality && legacyQuality !== normalizedQuality) {
        try {
            return await getMediaSource(musicItem, legacyQuality);
        } catch (e) {
            if (!firstError) {
                throw e;
            }
        }
    }

    if (firstError) {
        throw firstError;
    }

    return result;
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
        await this.ensurePluginReady("getMediaSource");
        const normalizedQuality = convertLegacyQuality(quality);
        const legacyQuality = convertToLegacyQuality(normalizedQuality);
        // 1. 本地搜索 其实直接读mediameta就好了
        const localPathInMediaExtra = getMediaExtraProperty(musicItem, "localPath");
        const localPath = getLocalPath(musicItem);
        const remoteMediaUrl =
            isRemoteMediaUrl(localPath)
                ? localPath
                : musicItem.platform === localPluginPlatform &&
                    isRemoteMediaUrl(musicItem.url)
                    ? musicItem.url
                    : null;
        if (remoteMediaUrl) {
            trace("网络音频播放", remoteMediaUrl);
            return {
                url: remoteMediaUrl,
            };
        }
        const normalizedLocalPath =
            localPath && !localPath.startsWith("content://")
                ? normalizeLocalFilePath(localPath)
                : localPath;
        if (
            normalizedLocalPath &&
            (
                normalizedLocalPath.startsWith("content://") ||
                await exists(normalizedLocalPath)
            )
        ) {
            trace("本地播放", normalizedLocalPath);
            if (localPathInMediaExtra !== normalizedLocalPath) {
                // 修正一下本地数据
                patchMediaExtra(musicItem, {
                    localPath: normalizedLocalPath,
                });

            }
            return {
                url: addFileScheme(normalizedLocalPath),
            };
        } else if (localPathInMediaExtra) {
            patchMediaExtra(musicItem, {
                localPath: undefined,
            });
        }

        if (musicItem.platform === localPluginPlatform) {
            throw new Error("本地音乐不存在");
        }
        // 2. 缓存播放
        const mediaCache = MediaCache.getMediaCache(
            musicItem,
        ) as IMusic.IMusicItem | null;
        const pluginCacheControl =
            this.plugin.instance.cacheControl ?? "no-cache";
        if (
            mediaCache &&
            (
                mediaCache?.source?.[normalizedQuality]?.url ||
                (legacyQuality ? mediaCache?.source?.[legacyQuality]?.url : undefined)
            ) &&
            (pluginCacheControl === CacheControl.Cache ||
                (pluginCacheControl === CacheControl.NoCache &&
                    Network.isOffline))
        ) {
            trace("播放", "缓存播放");
            const qualityInfo =
                mediaCache.source?.[normalizedQuality] ??
                (legacyQuality ? mediaCache.source?.[legacyQuality] : undefined);
            return {
                url: qualityInfo!.url,
                headers: mediaCache.headers,
                userAgent:
                    mediaCache.userAgent ?? mediaCache.headers?.["user-agent"],
            };
        }
        // 3. 音源重定向
        const alternativePluginTarget = Plugin.pluginManager?.getAlternativePluginName(this.plugin);
        if (LxSource.isRedirectTarget(alternativePluginTarget)) {
            devLog("info", "设置了LX自定义源重定向");
            const lxMediaSourceResult = await LxSource.getMediaSourceByRedirectTarget(
                alternativePluginTarget!,
                musicItem,
                normalizedQuality,
            );
            if (!lxMediaSourceResult?.url) {
                return null;
            }

            const result = this.normalizeMediaSourceResult(lxMediaSourceResult);
            if (
                pluginCacheControl !== CacheControl.NoStore &&
                !notUpdateCache
            ) {
                const cacheSource = {
                    headers: result.headers,
                    userAgent: result.userAgent,
                    url: result.url!,
                };
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

        if (alternativePlugin) {
            devLog("info", "设置了替代插件，实际使用的插件为", parserPlugin.name);
        }

        // 4. 插件解析
        if (!parserPlugin.instance.getMediaSource) {
            const qualityInfo =
                musicItem?.qualities?.[normalizedQuality] ??
                (legacyQuality ? musicItem?.qualities?.[legacyQuality] : undefined);
            const directUrl = qualityInfo?.url ?? musicItem.url;
            if (!directUrl) {
                return null;
            }
            return this.normalizeMediaSourceResult({
                url: directUrl,
            });
        }
        try {
            const qualityInfo =
                musicItem?.qualities?.[normalizedQuality] ??
                (legacyQuality ? musicItem?.qualities?.[legacyQuality] : undefined);
            const mediaSourceResult: IPlugin.IMediaSourceResult = (await callGetMediaSourceWithLegacyFallback(
                parserPlugin.instance.getMediaSource,
                musicItem,
                normalizedQuality,
            )) ?? { url: qualityInfo?.url };
            const { url, headers, ekey } = mediaSourceResult;
            if (!url) {
                throw new Error("NOT RETRY");
            }
            trace("播放", "插件播放");
            const result = this.normalizeMediaSourceResult({
                url,
                headers,
                ekey,
            } as IPlugin.IMediaSourceResult);

            if (
                pluginCacheControl !== CacheControl.NoStore &&
                !notUpdateCache
            ) {
                // 更新缓存
                const cacheSource = {
                    headers: result.headers,
                    userAgent: result.userAgent,
                    url,
                };
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
            if (retryCount > 0 && e?.message !== "NOT RETRY") {
                await delay(150);
                return this.getMediaSource(musicItem, quality, --retryCount);
            }
            this.recordError("getMediaSource", e, parserPlugin);
            errorLog("获取真实源失败", e?.message);
            devLog("error", "获取真实源失败", e, e?.message);
            return null;
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
                        await axios
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

    private lazyProps: ILazyProps | null = null;

    static pluginManager: IPluginManager;

    static injectDependencies(
        pluginManager: IPluginManager,
    ) {
        Plugin.pluginManager = pluginManager;
    }

    constructor(
        funcCode: string | (() => IPlugin.IPluginDefine) | null,
        pluginPath: string,
        lazyProps: ILazyProps | null = null
    ) {
        this.lazyProps = lazyProps;
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
            // 初始化方法，但实际调用时会先挂载插件
            this.methods = new PluginMethodsWrapper(this, this.ensureMounted.bind(this));
        }
    }

    async ensureMounted() {
        if ((this.state === PluginState.Initializing) && this.lazyProps) {
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
        if (this.state === PluginState.Error) {
            throw new Error(this.errorMessage || "插件加载失败");
        }
    }

    private mountPlugin(
        funcCode: string | (() => IPlugin.IPluginDefine),
        pluginPath: string) {
        this.state = PluginState.Loading;
        let _instance: IPlugin.IPluginDefine;

        const _module: any = { exports: {} };
        try {
            if (typeof funcCode === "string") {
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
                    return function(require, __musicfree_require, module, exports, console, env, URL, URLSearchParams, process) {
                        ${funcCode}
                    }
                `)()(
                    _require,
                    _require,
                    _module,
                    _module.exports,
                    _console,
                    env,
                    URL,
                    URLSearchParams,
                    _process
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
            const normalizedLocalPath = normalizeLocalFilePath(localPath);
            if (!shouldReadLocalSystemMetadata(normalizedLocalPath)) {
                return {
                    artwork: "",
                };
            }
            const coverImg = await Mp3Util.getMediaCoverImg(
                normalizedLocalPath,
            );
            return {
                artwork: coverImg,
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

        if (shouldReadLocalSystemMetadata(localPath)) {
            try {
                meta = await Mp3Util.getBasicMeta(localPath);
            } catch (e: any) {
                trace("本地音乐元信息读取失败", {
                    localPath,
                    message: e?.message ?? String(e),
                });
            }
        } else {
            trace("本地音乐跳过系统元信息读取", localPath);
        }

        try {
            const fileStat = await stat(localPath);
            id =
                CryptoJs.MD5(
                    fileStat.originalFilepath ?? fileStat.path ?? localPath,
                ).toString(
                    CryptoJs.enc.Hex,
                ) || nanoid();
        } catch (e) {
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
