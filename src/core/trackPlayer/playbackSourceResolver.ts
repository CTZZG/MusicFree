import BackgroundTimer from "react-native-background-timer";
import { errorLog, trace } from "@/utils/log";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { convertToLegacyQuality, getQualityOrder } from "@/utils/qualities";
import MediaCache from "../mediaCache";
import type { IAppConfig } from "@/types/core/config";
import { IPluginManager } from "@/types/core/pluginManager";
import type {
    PlayerAdapterTrackSourceMeta,
    PlayerAdapterTrackSourceOrigin,
} from "@/core/playerAdapter";
import {
    MediaSourceTimeoutError,
    mediaSourceTimeoutMs,
    TimedOutSources,
    withMediaSourceTimeout,
} from "./mediaSourceTimeoutPolicy";
import {
    isUnsupportedEncryptedMediaSource,
    resolveEncryptedMediaStreamIfNeeded,
} from "@/service/encryptedMediaProxy";
import {
    findAlternateCandidates,
    forgetAlternate,
    getRememberedAlternate,
    rememberAlternate,
} from "./alternateSource";
import { resolveMediaSourceCandidate } from "../mediaSource/resolveCandidate";
import { validateRemoteMediaUrlForPlayback } from "@/utils/remoteMediaUrl";
import { isMediaHttpAllowed } from "@/utils/mediaHttpCompatibilityPolicy";
import {
    isProviderAccessFailure,
    classifyMediaSourceFailure,
    createMediaSourceFailure,
    createMediaSourceFailureResult,
    mediaSourceFailureFromPluginResult,
    type MediaSourceAttemptType,
    type MediaSourceFailure,
    type MediaSourceFailureContext,
} from "@/core/pluginManager/mediaSourceFailure";

/**
 * 播放取源：URL / 加密准备、插件期限和备用来源查询。
 * 每次请求的取消检查、超时记录由调用方传入；这里不持有播放意图、焦点或队列事务。
 */
interface PlaybackSourceDependencies {
    // TrackPlayer 在服务注入前创建，运行时查询也能读取最新配置与插件状态。
    config: () => IAppConfig;
    plugins: () => IPluginManager;
    onAlternateInUse: (musicItem: IMusic.IMusicItem, alternate: IMusic.IMusicItem | null) => void;
}

interface IAlternateSourceResult {
    /** 实际取到地址的那个来源里的同一首歌 */
    musicItem: IMusic.IMusicItem;
    source: IPlugin.IMediaSourceResult;
    quality: IMusic.IQualityKey;
}

function hasPlayableSourceUrl(
    source?: {url?: string | null} | null,
): source is {url: string} {
    return typeof source?.url === "string" && source.url.trim().length > 0;
}

export default class PlaybackSourceResolver {
    constructor(private readonly dependencies: PlaybackSourceDependencies) {}

    private get configService() {
        return this.dependencies.config();
    }

    private get pluginManagerService() {
        return this.dependencies.plugins();
    }

    private createPlaybackSourceMeta(
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): PlayerAdapterTrackSourceMeta {
        return {
            ...(quality ? { quality } : {}),
            origin,
            cacheKey:
                mediaItem.platform && mediaItem.id
                    ? getMediaUniqueKey(mediaItem)
                    : undefined,
            recovered,
            resolvedAt: Date.now(),
        };
    }

    private withPlaybackSourceMeta<T extends IPlugin.IMediaSourceResult | null>(
        source: T,
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): T {
        if (!source) {
            return source;
        }
        return {
            ...source,
            playbackSource: this.createPlaybackSourceMeta(
                mediaItem,
                source.quality ?? quality,
                origin,
                recovered,
            ),
        } as T;
    }

    async createPlayableSource(
        source: IPlugin.IMediaSourceResult | null | undefined,
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        let sourceWithMeta = this.withPlaybackSourceMeta(
            source ?? null,
            mediaItem,
            quality,
            origin,
            recovered,
        );
        const failureContext: MediaSourceFailureContext = {
            mediaKey:
                mediaItem.platform && mediaItem.id
                    ? getMediaUniqueKey(mediaItem)
                    : undefined,
            pluginName: mediaItem.platform,
            quality,
        };
        if (!hasPlayableSourceUrl(sourceWithMeta)) {
            return sourceWithMeta?.failure
                ? sourceWithMeta
                : createMediaSourceFailureResult(
                    createMediaSourceFailure("unavailable", failureContext),
                );
        }
        const allowInsecureHttpPlayback = isMediaHttpAllowed(
            this.configService,
        );
        if (/^https?:\/\//i.test(sourceWithMeta.url)) {
            const validation = await validateRemoteMediaUrlForPlayback(
                sourceWithMeta.url,
                {
                    allowHttp: allowInsecureHttpPlayback,
                },
            );
            if (!validation.ok) {
                errorLog("远程音源策略拒绝", validation.reason);
                return createMediaSourceFailureResult(
                    classifyMediaSourceFailure(
                        new Error(validation.reason),
                        failureContext,
                    ),
                );
            }
            sourceWithMeta = {
                ...sourceWithMeta,
                url: validation.url,
                allowInsecureHttpPlayback:
                    allowInsecureHttpPlayback &&
                    new URL(validation.url).protocol === "http:",
            };
        }
        if (this.isUnsupportedEncryptedSource(sourceWithMeta)) {
            return createMediaSourceFailureResult(
                createMediaSourceFailure(
                    "encrypted-unsupported",
                    failureContext,
                ),
            );
        }

        try {
            const playableSource =
                await resolveEncryptedMediaStreamIfNeeded(sourceWithMeta);
            return hasPlayableSourceUrl(playableSource)
                ? playableSource
                : createMediaSourceFailureResult(
                    createMediaSourceFailure(
                        "source-rejected",
                        failureContext,
                    ),
                );
        } catch (error: any) {
            errorLog("加密音源代理失败", {
                musicId: mediaItem.id,
                platform: mediaItem.platform,
                reason: error?.message ?? error,
            });
            return createMediaSourceFailureResult(
                classifyMediaSourceFailure(error, failureContext),
            );
        }
    }

    isUnsupportedEncryptedSource(
        source?: {
            url?: string | null;
            ekey?: string | null;
            cek?: string | null;
        } | null,
    ) {
        return isUnsupportedEncryptedMediaSource(source);
    }

    private getPlayQualityOrder() {
        return getQualityOrder(
            this.configService.getConfig("basic.defaultPlayQuality") ??
                "standard",
            this.configService.getConfig("basic.playQualityOrder") ?? "asc",
        );
    }

    /**
     * 向插件要播放地址，最多等 mediaSourceTimeoutMs，超时以
     * MediaSourceTimeoutError 拒绝。
     *
     * 插件的 Promise 可能永远不完成。所有取源入口（播放、手动切歌预取、预解析
     * 后面几首、地址过期后重取、换音质、备用来源、恢复上次播放）都走这里：
     * 以前只有 play() 有期限，MPV 手动切歌的预取直接 await 插件，挂住时当前
     * 歌曲已经暂停，后面的切歌都排在串行队列里等它。迟到的结果由各调用方
     * 自己的事务 / generation 守卫挡住。
     *
     * 计时用 BackgroundTimer：通知栏、锁屏切歌时 App 在后台，RN 的普通定时器
     * 要等回到前台才触发。
     */
    async requestPluginMediaSource(
        plugin: ReturnType<IPluginManager["getByName"]> | null | undefined,
        musicItem: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
        timedOutSources?: TimedOutSources,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const pluginName: string | undefined = plugin?.name;
        const mediaKey = getMediaUniqueKey(musicItem);
        if (pluginName && timedOutSources?.has(pluginName, mediaKey)) {
            // 这次切歌里已经等满过一次期限：不再重问，按超时处理
            throw new MediaSourceTimeoutError(mediaSourceTimeoutMs, true);
        }
        const task = plugin?.methods?.getMediaSource(musicItem, quality);
        if (!task) {
            return null;
        }
        try {
            return (
                (await withMediaSourceTimeout(Promise.resolve(task), {
                    setTimer: (handler, delayMs) =>
                        BackgroundTimer.setTimeout(handler, delayMs),
                    clearTimer: handle => BackgroundTimer.clearTimeout(handle),
                })) ?? null
            );
        } catch (error) {
            if (error instanceof MediaSourceTimeoutError && pluginName) {
                timedOutSources?.add(pluginName, mediaKey);
            }
            throw error;
        }
    }

    /**
     * 预取、重取用：插件没回应时返回 "timed-out"，调用方不再逐个音质各等一遍，
     * 直接去试歌曲自带的地址和记住的其他来源。插件报错照旧抛出。
     */
    private async requestPluginMediaSourceOrStop(
        plugin: ReturnType<IPluginManager["getByName"]> | null | undefined,
        musicItem: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
        timedOutSources?: TimedOutSources,
    ): Promise<IPlugin.IMediaSourceResult | null | "timed-out"> {
        try {
            return await this.requestPluginMediaSource(
                plugin,
                musicItem,
                quality,
                timedOutSources,
            );
        } catch (error) {
            if (!(error instanceof MediaSourceTimeoutError)) {
                throw error;
            }
            trace(
                "插件取源超时，不再尝试其他音质",
                {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                    quality,
                    timeoutMs: error.timeoutMs,
                    earlierAttempt: error.earlierAttempt,
                },
                "error",
            );
            return "timed-out";
        }
    }

    async resolveDirectMediaSource(
        musicItem: IMusic.IMusicItem,
        timedOutSources?: TimedOutSources,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = this.getPlayQualityOrder();

        for (let quality of qualityOrder) {
            const candidate = await this.requestPluginMediaSourceOrStop(
                plugin,
                musicItem,
                quality,
                timedOutSources,
            );
            if (candidate === "timed-out") {
                break;
            }
            if (candidate?.failure && isProviderAccessFailure(mediaSourceFailureFromPluginResult(candidate.failure, {
                mediaKey: getMediaUniqueKey(musicItem), pluginName: plugin?.name ?? musicItem.platform, quality,
            }))) {
                break;
            }
            if (candidate?.url) {
                const source = await this.createPlayableSource(
                    candidate,
                    musicItem,
                    quality,
                    "plugin",
                );
                if (source?.url) {
                    this.dependencies.onAlternateInUse(musicItem, null);
                    return source;
                }
            }
        }

        if (musicItem.source) {
            for (let quality of qualityOrder) {
                const legacyQuality = convertToLegacyQuality(quality);
                const directSource =
                    musicItem.source[quality] ??
                    (legacyQuality
                        ? musicItem.source[legacyQuality]
                        : undefined);
                if (directSource?.url) {
                    const source = await this.createPlayableSource(
                        directSource,
                        musicItem,
                        quality,
                        "embedded-cache",
                    );
                    if (source?.url) {
                        return source;
                    }
                }
            }
        }

        if (musicItem.url) {
            return this.createPlayableSource(
                {
                    url: musicItem.url,
                    ekey: musicItem.ekey,
                    cek: musicItem.cek,
                },
                musicItem,
                undefined,
                "direct",
            );
        }

        // 切歌、预先准备后面几首时只用记住的其他来源，不在这里搜：搜索要好几秒，
        // 还会在后台连着发请求。没记住的交给 play() 去找。
        const remembered =
            (this.configService.getConfig("basic.tryChangeSourceWhenPlayFail") ?? true)
                ? getRememberedAlternate(musicItem)
                : null;
        if (remembered) {
            const alternate = await this.resolveSourceFromAlternate(
                remembered,
                qualityOrder,
                () => true,
                undefined,
                timedOutSources,
            );
            if (alternate && alternate !== "inactive") {
                this.dependencies.onAlternateInUse(musicItem, alternate.musicItem);
                return alternate.source;
            }
        }

        return null;
    }

    async resolveFreshMediaSource(
        musicItem: IMusic.IMusicItem,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        MediaCache.removeMediaCache(musicItem);
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = this.getPlayQualityOrder();

        for (let quality of qualityOrder) {
            const candidate = await this.requestPluginMediaSourceOrStop(
                plugin,
                musicItem,
                quality,
            );
            if (candidate === "timed-out") {
                break;
            }
            if (candidate?.failure && isProviderAccessFailure(mediaSourceFailureFromPluginResult(candidate.failure, {
                mediaKey: getMediaUniqueKey(musicItem), pluginName: plugin?.name ?? musicItem.platform, quality,
            }))) {
                break;
            }
            if (candidate?.url) {
                const source = await this.createPlayableSource(
                    candidate,
                    musicItem,
                    quality,
                    "recovery",
                    true,
                );
                if (source?.url) {
                    return source;
                }
            }
        }

        if (musicItem.url) {
            const directSource = {
                url: musicItem.url,
                ekey: musicItem.ekey,
                cek: musicItem.cek,
            };
            return this.createPlayableSource(
                directSource,
                musicItem,
                undefined,
                "recovery",
                true,
            );
        }

        // 播放地址过期后重新取：原来源还是不行，就用记住的其他来源
        const remembered =
            (this.configService.getConfig("basic.tryChangeSourceWhenPlayFail") ?? true)
                ? getRememberedAlternate(musicItem)
                : null;
        if (remembered) {
            MediaCache.removeMediaCache(remembered);
            const alternate = await this.resolveSourceFromAlternate(
                remembered,
                qualityOrder,
                () => true,
            );
            if (alternate && alternate !== "inactive") {
                this.dependencies.onAlternateInUse(musicItem, alternate.musicItem);
                return alternate.source;
            }
        }

        return null;
    }

    /**
     * 原来源取不到地址时，换到其他来源的同一个录音（规则见 alternateSource.ts）。
     * 先试上次换成功的来源；不行再到其他已启用的来源里搜，搜到的按接近程度逐个试。
     */
    async resolveAlternateSource(
        musicItem: IMusic.IMusicItem,
        qualityOrder: IMusic.IQualityKey[],
        isPlayRequestActive: () => boolean,
        rememberSourceFailure: (
            failure?: MediaSourceFailure | null,
            attemptType?: MediaSourceAttemptType,
        ) => void,
        timedOutSources?: TimedOutSources,
    ): Promise<IAlternateSourceResult | "inactive" | null> {
        const tried = new Set<string>();
        const tryCandidate = async (alternate: IMusic.IMusicItem) => {
            const key = getMediaUniqueKey(alternate);
            if (tried.has(key)) {
                return null;
            }
            tried.add(key);
            return this.resolveSourceFromAlternate(
                alternate,
                qualityOrder,
                isPlayRequestActive,
                rememberSourceFailure,
                timedOutSources,
            );
        };

        const remembered = getRememberedAlternate(musicItem);
        if (remembered) {
            const result = await tryCandidate(remembered);
            if (result) {
                return result;
            }
            forgetAlternate(musicItem);
        }

        const sources = this.pluginManagerService
            .getSortedSearchablePlugins("music")
            .map(plugin => ({
                name: plugin.name,
                search: async (keyword: string) =>
                    (await plugin.methods.search(keyword, 1, "music"))
                        ?.data as IMusic.IMusicItem[] | undefined,
            }));
        const candidates = await findAlternateCandidates(musicItem, sources, {
            timeoutMs: 8000,
            isCancelled: () => !isPlayRequestActive(),
        });
        if (!isPlayRequestActive()) {
            return "inactive";
        }
        trace("查找其他来源", {
            musicId: musicItem.id,
            platform: musicItem.platform,
            candidates: candidates.length,
        });
        for (const candidate of candidates) {
            const result = await tryCandidate(candidate);
            if (result === "inactive") {
                return result;
            }
            if (result) {
                rememberAlternate(musicItem, candidate);
                return result;
            }
        }
        return null;
    }

    /** 用另一个来源的同一首歌取播放地址，按音质顺序逐个试 */
    async resolveSourceFromAlternate(
        alternate: IMusic.IMusicItem,
        qualityOrder: IMusic.IQualityKey[],
        isActive: () => boolean,
        rememberSourceFailure?: (
            failure?: MediaSourceFailure | null,
            attemptType?: MediaSourceAttemptType,
        ) => void,
        timedOutSources?: TimedOutSources,
    ): Promise<IAlternateSourceResult | "inactive" | null> {
        const plugin = this.pluginManagerService.getByMedia(alternate);
        if (!plugin || !this.pluginManagerService.isPluginEnabled(plugin)) {
            return null;
        }
        return resolveMediaSourceCandidate({
            musicItem: alternate,
            pluginName: plugin.name,
            qualityOrder,
            isActive,
            isTimeout: error => error instanceof MediaSourceTimeoutError,
            request: quality => this.requestPluginMediaSource(plugin, alternate, quality, timedOutSources),
            prepare: (candidate, quality) => this.isUnsupportedEncryptedSource(candidate)
                ? Promise.resolve(createMediaSourceFailureResult(createMediaSourceFailure("encrypted-unsupported", {
                    mediaKey: getMediaUniqueKey(alternate), pluginName: plugin.name, quality,
                })))
                : this.createPlayableSource(candidate, alternate, quality, "similar-plugin"),
            onFailure: failure => rememberSourceFailure?.(failure, "similar"),
        });
    }
}
