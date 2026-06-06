import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog";
import {
    sortIndexSymbol,
    timeStampSymbol,
} from "@/constants/commonConst";
import delay from "@/utils/delay";
import getUrlExt from "@/utils/getUrlExt";
import { errorLog, trace } from "@/utils/log";
import { createMediaIndexMap } from "@/utils/mediaIndexMap";
import {
    getMediaUniqueKey,
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { hasEncryptedMediaSource } from "@/utils/mflac";
import Network from "@/utils/network";
import PersistStatus from "@/utils/persistStatus";
import { convertToLegacyQuality, getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { produce } from "immer";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import shuffle from "lodash.shuffle";
import { useEffect } from "react";
import LocalMusicSheet from "../localMusicSheet";

import { MusicRepeatMode, TrackPlayerEvents } from "@/constants/trackPlayerConst";
import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory";
import { ITrackPlayer } from "@/types/core/trackPlayer/index";
import minDistance from "@/utils/minDistance";
import { IPluginManager } from "@/types/core/pluginManager";
import { getAppUserAgent } from "@/utils/userAgentHelper"; // <--- 新增UA统一导入
import { ImgAsset } from "@/constants/assetsConst";
import { resolveImportedAssetOrPath } from "@/utils/fileUtils";
import type {
    PlayerAdapter,
    PlayerAdapterProgress,
    PlayerAdapterRepeatMode,
    PlayerBackendState,
    PlayerAdapterTrack,
} from "@/core/playerAdapter";
import nitroPlayerAdapter from "@/core/playerAdapter/nitroPlayerAdapter";
import { normalizeMusicState } from "@/utils/trackUtils";


type MusicFreePlayerTrack =
    PlayerAdapterTrack &
    Partial<IMusic.IMusicItem> &
    Record<string, any>;

const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
const repeatModeAtom = atom<MusicRepeatMode>(MusicRepeatMode.QUEUE);
const qualityAtom = atom<IMusic.IQualityKey>("standard");
const playListAtom = atom<IMusic.IMusicItem[]>([]);
const musicStateAtom = atom<PlayerBackendState>("idle");
const progressAtom = atom<PlayerAdapterProgress>({
    position: 0,
    duration: 0,
    buffered: 0,
});

function normalizeAdapterProgress(
    progress?: Partial<PlayerAdapterProgress> | null,
    fallbackDuration = 0,
): PlayerAdapterProgress {
    const position = Number(progress?.position);
    const duration = Number(progress?.duration);
    const buffered = Number(progress?.buffered);

    return {
        position: Number.isFinite(position) ? position : 0,
        duration:
            Number.isFinite(duration) && duration > 0
                ? duration
                : fallbackDuration,
        buffered: Number.isFinite(buffered) ? buffered : 0,
    };
}

function setPlayerProgress(
    progress?: Partial<PlayerAdapterProgress> | null,
    fallbackDuration = 0,
) {
    const normalizedProgress = normalizeAdapterProgress(
        progress,
        fallbackDuration,
    );
    getDefaultStore().set(progressAtom, normalizedProgress);
    return normalizedProgress;
}


class TrackPlayer extends EventEmitter<{
    [TrackPlayerEvents.PlayEnd]: () => void;
    [TrackPlayerEvents.CurrentMusicChanged]: (musicItem: IMusic.IMusicItem | null) => void;
    [TrackPlayerEvents.ProgressChanged]: (progress: {
        position: number;
        duration: number;
    }) => void;
}> implements ITrackPlayer {
    // 依赖
    private configService!: IAppConfig;
    private musicHistoryService!: IMusicHistory;
    private pluginManagerService!: IPluginManager;

    // 当前播放的音乐下标
    private currentIndex = -1;
    // 音乐播放器服务是否启动
    private serviceInited = false;
    // 底层播放器桥接固定为 Nitro Player。
    private backend: PlayerAdapter<any> = nitroPlayerAdapter;
    private nitroPendingSourceRequests = new Set<string>();
    private nitroTrackChangeGuard: { key: string; until: number } | null = null;
    // 播放队列索引map
    private playListIndexMap = createMediaIndexMap([] as IMusic.IMusicItem[]);


    private static maxMusicQueueLength = 10000;
    private static halfMaxMusicQueueLength = 5000;
    private static toggleRepeatMapping = {
        [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
        [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
        [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
    };
    constructor() {
        super();
    }

    public get previousMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex - 1);
    }

    public get currentMusic() {
        return getDefaultStore().get(currentMusicAtom);
    }

    public get nextMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex + 1);
    }

    public get repeatMode() {
        return getDefaultStore().get(repeatModeAtom);
    }

    public get quality() {
        return getDefaultStore().get(qualityAtom);
    }

    public get playList() {
        return getDefaultStore().get(playListAtom);
    }

    public get playerAdapter() {
        return this.backend;
    }


    injectDependencies(configService: IAppConfig, musicHistoryService: IMusicHistory, pluginManager: IPluginManager): void {
        this.configService = configService;
        this.musicHistoryService = musicHistoryService;
        this.pluginManagerService = pluginManager;
    }

    lockBackend() {
        this.backend = nitroPlayerAdapter;
    }

    async setupTrackPlayer() {
        this.lockBackend();
        const rate = PersistStatus.get("music.rate");
        const musicQueue = PersistStatus.get("music.playList");
        const repeatMode = PersistStatus.get("music.repeatMode");
        const progress = PersistStatus.get("music.progress");
        let track = PersistStatus.get("music.musicItem"); // <--- 改为 let
        const quality =
            PersistStatus.get("music.quality") ||
            this.configService.getConfig("basic.defaultPlayQuality") ||
            "standard";

        await this.backend.setVolume(1);
        // 状态恢复
        if (rate) {
            await this.backend.setRate(+rate / 100);
        }
        if (repeatMode) {
            getDefaultStore().set(repeatModeAtom, repeatMode as MusicRepeatMode);
        }
        await this.syncBackendRepeatMode();

        if (musicQueue && Array.isArray(musicQueue)) {
            this.addAll(
                musicQueue,
                undefined,
                repeatMode === MusicRepeatMode.SHUFFLE,
            );
        }
        if (track && !this.isInPlayList(track)) {
            this.add(track);
        }

        if (track && this.isInPlayList(track)) {
            if (!this.configService.getConfig("basic.autoPlayWhenAppStart")) {
                track.isInit = true;
            }
            // 添加 UA
            track.userAgent = track.userAgent || getAppUserAgent();

            // 异步
            this.pluginManagerService.getByMedia(track)
                ?.methods.getMediaSource(track, quality)
                .then(async newSource => {
                    if (this.isUnsupportedEncryptedSource(newSource)) {
                        return;
                    }
                    track.url = newSource?.url || track.url;
                    track.headers = newSource?.headers || track.headers;
                    track.userAgent = track.userAgent || getAppUserAgent();

                    if (isSameMediaItem(this.currentMusic, track)) {
                        await this.setTrackSource(
                            track as MusicFreePlayerTrack,
                            false,
                            this.normalizeProgress(progress),
                        );
                    }
                })
                .catch(err => {
                    errorLog("恢复播放源失败", err?.message ?? err);
                });
            this.setCurrentMusic(track);
        }

        if (!this.serviceInited) {

            /**
             * 此事件可能会被触发多次（比如直接替换queue） 参考代码：https://github.com/doublesymmetry/KotlinAudio
             */
            this.backend.addEventListener(
                "trackChanged",
                async evt => {
                    if (this.shouldIgnoreNitroTrackChange(evt)) {
                        return;
                    }
                    const syncedMusic = this.syncNitroCurrentMusic(
                        evt.track,
                    );
                    trace("Nitro 队列切歌", {
                        index: evt.index,
                        reason: evt.reason,
                        musicId: syncedMusic?.id,
                        platform: syncedMusic?.platform,
                    });
                    if (evt.reason === "end" || evt.reason === "repeat") {
                        this.emit(TrackPlayerEvents.PlayEnd);
                    }
                },
            );

            this.backend.addEventListener(
                "tracksNeedUpdate",
                async evt => {
                    await this.resolveNitroQueuedTracks(evt?.tracks ?? []);
                },
            );

            this.backend.addEventListener(
                "playbackError",
                async e => {
                    errorLog("播放出错", e.message);
                    // WARNING: 不稳定，报错的时候有可能track已经变到下一首歌去了
                    const currentTrack =
                        await this.backend.getActiveTrack?.();
                    if (currentTrack?.isInit) {
                        // HACK: 避免初始失败的情况
                        await this.backend.updateTrack({
                            ...currentTrack,
                            // @ts-ignore
                            isInit: undefined,
                            userAgent: getAppUserAgent(), // <--- 添加UA
                        } as MusicFreePlayerTrack, 0);
                        return;
                    }

                    if (
                        e.message &&
                        e.message !== "android-io-file-not-found"
                    ) {
                        trace("播放出错", {
                            message: e.message,
                            code: e.code,
                        });

                        this.handlePlayFail();
                    }
                },
            );

            this.backend.addEventListener("playbackStateChanged", state => {
                getDefaultStore().set(
                    musicStateAtom,
                    normalizeMusicState(state),
                );
            });

            this.backend.addEventListener("progress", progress => {
                setPlayerProgress(progress, this.currentMusic?.duration ?? 0);
            });

            this.serviceInited = true;
        }
    }

    /**************** 播放队列 ******************/
    getMusicIndexInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return -1;
        }
        return this.playListIndexMap.getIndex(musicItem);
    }

    isInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return false;
        }

        return this.playListIndexMap.has(musicItem);
    }

    getPlayListMusicAt(index: number): IMusic.IMusicItem | null {
        const playList = this.playList;
        const len = playList.length;
        if (len === 0) {
            return null;
        }
        return playList[(index % len + len) % len]; // <--- 修正取模确保正数
    }

    private getWrappedPlayListIndex(index: number) {
        const len = this.playList.length;
        if (len === 0) {
            return -1;
        }
        return (index % len + len) % len;
    }

    isPlayListEmpty() {
        return this.playList.length === 0;
    }

    /****** 播放逻辑 *****/
    addAll(
        musicItems: Array<IMusic.IMusicItem>,
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): void {
        const now = Date.now();
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentPlayList = this.playList;
        const queueMusicItems = musicItems.map((item, index) => ({
            ...item,
            [timeStampSymbol]: now,
            [sortIndexSymbol]: index,
        }));

        if (beforeIndex === undefined || beforeIndex < 0) {
            // 1.1. 添加到歌单末尾，并过滤掉已有的歌曲
            newPlayList = currentPlayList.concat(
                queueMusicItems.filter(item => !this.isInPlayList(item)),
            );
        } else {
            // 1.2. 新的播放列表，插入
            const indexMap = createMediaIndexMap(queueMusicItems);
            const beforeDraft = currentPlayList
                .slice(0, beforeIndex)
                .filter(item => !indexMap.has(item));
            const afterDraft = currentPlayList
                .slice(beforeIndex)
                .filter(item => !indexMap.has(item));

            newPlayList = [...beforeDraft, ...queueMusicItems, ...afterDraft];
        }

        // 如果太长了
        if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
            newPlayList = this.shrinkPlayListToSize(
                newPlayList,
                beforeIndex ?? newPlayList.length - 1,
            );
        }

        // 2. 如果需要随机
        if (shouldShuffle) {
            newPlayList = shuffle(newPlayList);
        }
        // 3. 设置播放列表
        this.setPlayList(newPlayList);
    }

    add(
        musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
        beforeIndex?: number,
    ): void {
        this.addAll(
            Array.isArray(musicItem) ? musicItem : [musicItem],
            beforeIndex,
        );
    }

    addNext(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]): void {
        const shouldAutoPlay = this.isPlayListEmpty() || !this.currentMusic;
        const musicItems = Array.isArray(musicItem) ? musicItem : [musicItem];
        const insertIndex = this.currentIndex + 1;
        const newItems = musicItems.filter(item => !this.isInPlayList(item));

        this.add(musicItems, insertIndex);

        if (!shouldAutoPlay && newItems.length > 0) {
            this.syncNitroQueueInsert(newItems, insertIndex).catch(error => {
                errorLog("Nitro 同步下一首队列失败", error?.message ?? error);
            });
        }

        if (shouldAutoPlay) {
            this.play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
        }
    }

    async remove(musicItem: IMusic.IMusicItem): Promise<void> {
        const playList = this.playList;

        let newPlayList: IMusic.IMusicItem[] = [];
        let currentMusic: IMusic.IMusicItem | null = this.currentMusic;
        const targetIndex = this.getMusicIndexInPlayList(musicItem);
        let shouldPlayCurrent: boolean | null = null;
        if (targetIndex === -1) {
            // 1. 这种情况应该是出错了
            return;
        }
        // 2. 移除的是当前项
        if (this.currentIndex === targetIndex) {
            // 2.1 停止播放，移除当前项
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 2.2 设置新的播放列表，并更新当前音乐
            if (newPlayList.length === 0) {
                currentMusic = null;
                shouldPlayCurrent = false;
            } else {
                currentMusic = newPlayList[this.currentIndex % newPlayList.length];
                try {
                    const state = await this.backend.getState();
                    shouldPlayCurrent = state === "playing";
                } catch {
                    shouldPlayCurrent = false;
                }
            }
            this.setCurrentMusic(currentMusic);
        } else {
            // 3. 删除
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 如果删除的是当前播放歌曲之前的项，需要调整currentIndex
            if (targetIndex < this.currentIndex) {
                this.currentIndex--;
            }
        }

        this.setPlayList(newPlayList);
        if (shouldPlayCurrent === true) {
            await this.play(currentMusic, true);
        } else if (shouldPlayCurrent === false) {
            await this.backend.reset();
        } else {
            await this.syncNitroQueueRemove(musicItem).catch(error => {
                errorLog("Nitro 同步移除队列失败", error?.message ?? error);
            });
        }
    }

    isCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        return isSameMediaItem(musicItem, this.currentMusic);
    }

    async play(
        musicItem?: IMusic.IMusicItem | null,
        forcePlay?: boolean,
    ): Promise<void> {
        try {
            trace("TrackPlayer.play start", {
                backend: this.backend.name,
                musicId: musicItem?.id ?? this.currentMusic?.id,
                platform: musicItem?.platform ?? this.currentMusic?.platform,
                forcePlay,
            });
            // 如果不传参，默认是播放当前音乐
            if (!musicItem) {
                musicItem = this.currentMusic;
            }
            trace("TrackPlayer.play resolved music", {
                backend: this.backend.name,
                musicId: musicItem?.id,
                platform: musicItem?.platform,
                isCurrent: this.isCurrentMusic(musicItem),
            });
            if (!musicItem) {
                throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
            }

            const seekToTime = this.resolveResumeSeekTime(musicItem);

            // 1. 移动网络禁止播放
            const localPath = getLocalPath(musicItem);
            if (
                Network.isCellular &&
                !this.configService.getConfig("basic.useCelluarNetworkPlay") &&
                !LocalMusicSheet.isLocalMusic(musicItem) &&
                !localPath
            ) {
                await this.backend.reset();
                trace("TrackPlayer.play blocked by cellular policy", {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                });
                throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
            }

            // 2. 如果是当前正在播放的音频
            const isCurrentMusic = this.isCurrentMusic(musicItem);
            const shouldUseCurrentFastPath = isCurrentMusic && !forcePlay;
            if (isCurrentMusic && !shouldUseCurrentFastPath) {
                trace("TrackPlayer.play bypass current fast path", {
                    backend: this.backend.name,
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                    forcePlay,
                });
            }
            if (shouldUseCurrentFastPath) {
                // 获取底层播放器中的track
                trace("TrackPlayer.play current branch getTrack start", {
                    backend: this.backend.name,
                });
                const currentTrack = await this.backend.getTrack?.(0);
                trace("TrackPlayer.play current branch getTrack end", {
                    hasTrack: !!currentTrack,
                    trackUrl: currentTrack?.url,
                    trackId: currentTrack?.id,
                    trackPlatform: currentTrack?.platform,
                });
                // 2.1 如果当前有源
                if (
                    currentTrack?.url &&
                    isSameMediaItem(
                        musicItem,
                        currentTrack as IMusic.IMusicItem,
                    )
                ) {
                    const currentActiveIndex =
                        await this.backend.getActiveTrackIndex?.();
                    if (currentActiveIndex !== 0) {
                        await this.backend.skipToIndex(0);
                    }
                    if (forcePlay) {
                        // 2.1.1 强制重新开始
                        await this.seekTo(0);
                    }
                    const currentState = await this.backend.getState();
                    if (currentState === "stopped") {
                        await this.setTrackSource(currentTrack, true, seekToTime);
                    }
                    if (currentState !== "playing") {
                        // 2.1.2 恢复播放
                        await this.backend.play();
                    }
                    // 这种情况下，播放队列和当前歌曲都不需要变化
                    return;
                }
                // 2.2 其他情况：重新获取源
            }

            // 3. 如果没有在播放列表中，添加到队尾；同时更新列表状态
            const inPlayList = this.isInPlayList(musicItem);
            if (!inPlayList) {
                this.add(musicItem);
            }

            // 4. 更新列表状态和当前音乐
            this.setCurrentMusic(musicItem);
            const proposedProgress = setPlayerProgress(
                {
                    position: seekToTime ?? 0,
                    duration: musicItem.duration || 0,
                    buffered: seekToTime ?? 0,
                },
                musicItem.duration || 0,
            );
            this.emit(TrackPlayerEvents.ProgressChanged, proposedProgress);

            // 5. 获取音源
            let track: IMusic.IMusicItem;

            // 5.1 通过插件获取音源
            const plugin = this.pluginManagerService.getByName(musicItem.platform);
            // 5.2 获取音质排序
            const qualityOrder = getQualityOrder(
                this.configService.getConfig("basic.defaultPlayQuality") ?? "standard",
                this.configService.getConfig("basic.playQualityOrder") ?? "asc",
            );
            // 5.3 插件返回音源
            let source: IPlugin.IMediaSourceResult | null = null;
            for (let quality of qualityOrder) {
                if (this.isCurrentMusic(musicItem)) {
                    trace("TrackPlayer.play getMediaSource start", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                        quality,
                    });
                    const candidate =
                        (await plugin?.methods?.getMediaSource(
                            musicItem,
                            quality,
                        )) ?? null;
                    trace("TrackPlayer.play getMediaSource end", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                        quality,
                        hasSource: !!candidate?.url,
                        sourceUrl: candidate?.url,
                    });
                    if (this.isUnsupportedEncryptedSource(candidate)) {
                        continue;
                    }
                    // 5.3.1 获取到真实源
                    if (candidate?.url) {
                        source = candidate;
                        this.setQuality(quality);
                        break;
                    }
                } else {
                    // 5.3.2 已经切换到其他歌曲了，
                    return;
                }
            }

            if (!this.isCurrentMusic(musicItem)) {
                return;
            }
            if (!source) {
                // 如果有source
                if (musicItem.source) {
                    for (let quality of qualityOrder) {
                        const legacyQuality = convertToLegacyQuality(quality);
                        const directSource =
                            musicItem.source[quality] ??
                            (legacyQuality ? musicItem.source[legacyQuality] : undefined);
                        if (
                            directSource?.url &&
                            !this.isUnsupportedEncryptedSource(directSource)
                        ) {
                            source = directSource;
                            this.setQuality(quality);

                            break;
                        }
                    }
                }
                // 5.4 没有返回源
                if (!source && !musicItem.url) {
                    // 插件失效的情况
                    if (this.configService.getConfig("basic.tryChangeSourceWhenPlayFail")) {
                        // 重试
                        const similarMusic = await this.getSimilarMusic(
                            musicItem,
                            "music",
                            () => !this.isCurrentMusic(musicItem),
                        );

                        if (similarMusic) {
                            const similarMusicPlugin =
                                this.pluginManagerService.getByMedia(similarMusic);

                            for (let quality of qualityOrder) {
                                if (this.isCurrentMusic(musicItem)) {
                                    const candidate =
                                        (await similarMusicPlugin?.methods?.getMediaSource(
                                            similarMusic,
                                            quality,
                                        )) ?? null;
                                    if (
                                        this.isUnsupportedEncryptedSource(
                                            candidate,
                                        )
                                    ) {
                                        continue;
                                    }
                                    // 5.4.1 获取到真实源
                                    if (candidate?.url) {
                                        source = candidate;
                                        this.setQuality(quality);
                                        break;
                                    }
                                } else {
                                    // 5.4.2 已经切换到其他歌曲了，
                                    return;
                                }
                            }
                        }

                        if (!source) {
                            throw new Error(PlayFailReason.INVALID_SOURCE);
                        }
                    } else {
                        throw new Error(PlayFailReason.INVALID_SOURCE);
                    }
                } else {
                    source = {
                        url: musicItem.url,
                        ekey: musicItem.ekey,
                    };
                    this.setQuality("192k");
                }
            }

            if (this.isUnsupportedEncryptedSource(source)) {
                throw new Error(PlayFailReason.INVALID_SOURCE);
            }

            // 6. 特殊类型源
            if (getUrlExt(source.url) === ".m3u8") {
                // @ts-ignore
                source.type = "hls";
            }
            // 7. 合并结果
            track = this.mergeTrackSource(musicItem, source) as IMusic.IMusicItem;

            track.userAgent = track.userAgent || getAppUserAgent();

            // 8. 新增历史记录
            this.musicHistoryService.addMusic(musicItem);

            trace("获取音源成功", track);
            // 9. 设置音源
            await this.setTrackSource(track as MusicFreePlayerTrack, true, seekToTime);

            // 10. 获取补充信息
            let info: Partial<IMusic.IMusicItem> | null = null;
            try {
                info =
                    (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
                if (
                    (typeof info?.url === "string" && info.url.trim() === "") ||
                    (info?.url && typeof info.url !== "string")
                ) {
                    delete info.url;
                }
            } catch { }

            // 11. 设置补充信息
            if (info && this.isCurrentMusic(musicItem)) {
                const mergedTrack = this.mergeTrackSource(track, info);
                mergedTrack.userAgent = mergedTrack.userAgent || getAppUserAgent();
                getDefaultStore().set(currentMusicAtom, mergedTrack as IMusic.IMusicItem);
                await this.backend.updateTrack(mergedTrack as unknown as MusicFreePlayerTrack, 0);
            }
        } catch (e: any) {
            const message = e?.message;
            trace("TrackPlayer.play error", {
                backend: this.backend.name,
                message,
                stack: e?.stack,
            }, "error");
            if (
                message ===
                "The player is not initialized. Call setupPlayer first."
            ) {
                await this.backend.setup();
                this.play(musicItem, forcePlay);
            } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
                if (getCurrentDialog()?.name !== "SimpleDialog") {
                    showDialog("SimpleDialog", {
                        title: "流量提醒",
                        content:
                            "当前非WIFI环境，侧边栏设置中打开【使用移动网络播放】功能后可继续播放",
                    });
                }
            } else if (message === PlayFailReason.INVALID_SOURCE) {
                trace("音源为空，播放失败");
                await this.handlePlayFail();
            } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
                // 队列是空的，不应该出现这种情况
            }
        }
    }

    async pause(): Promise<void> {
        await this.backend.pause();
    }

    toggleRepeatMode(): void {
        this.setRepeatMode(TrackPlayer.toggleRepeatMapping[this.repeatMode]);
    }

    // 清空播放队列
    async clearPlayList(): Promise<void> {
        this.setPlayList([]);
        this.setCurrentMusic(null);

        await this.backend.reset();
        PersistStatus.set("music.musicItem", undefined);
        PersistStatus.set("music.progress", 0);
    }

    async skipToNext(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        if (this.backend.getNextTracks) {
            const nextTracks = await this.backend.getNextTracks(1).catch(error => {
                errorLog(
                    "Nitro 下一首队列读取失败",
                    error?.message ?? error,
                );
                return [];
            });
            if (nextTracks.length > 0) {
                await this.resolveNitroQueuedTracks(nextTracks).catch(error => {
                    errorLog(
                        "Nitro 下一首音源预解析失败",
                        error?.message ?? error,
                    );
                });
            }
        }
        await this.backend.skipToNext();
    }

    async skipToPrevious(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        await this.backend.skipToPrevious();
    }

    async changeQuality(newQuality: IMusic.IQualityKey): Promise<boolean> {
        // 获取当前的音乐和进度
        if (newQuality === this.quality) {
            return true;
        }

        // 获取当前歌曲
        const musicItem = this.currentMusic;
        if (!musicItem) {
            return false;
        }
        try {
            const progress = await this.backend.getProgress();
            const plugin = this.pluginManagerService.getByMedia(musicItem);
            const newSource = await plugin?.methods?.getMediaSource(
                musicItem,
                newQuality,
            );
            if (!newSource?.url) {
                throw new Error(PlayFailReason.INVALID_SOURCE);
            }
            if (this.isUnsupportedEncryptedSource(newSource)) {
                throw new Error(PlayFailReason.INVALID_SOURCE);
            }
            if (this.isCurrentMusic(musicItem)) {
                const playingState = await this.backend.getState();
                await this.setTrackSource(
                    this.mergeTrackSource(musicItem, newSource) as unknown as MusicFreePlayerTrack,
                    playingState === "playing",
                );

                await this.seekTo(progress.position ?? 0);
                this.setQuality(newQuality);
            }
            return true;
        } catch {
            // 修改失败
            return false;
        }
    }

    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
    ): Promise<void> {
        try {
            trace("TrackPlayer.playWithReplacePlayList start", {
                musicId: musicItem?.id,
                platform: musicItem?.platform,
                inputLength: newPlayList?.length ?? 0,
                repeatMode: this.repeatMode,
            });
            if (!Array.isArray(newPlayList) || newPlayList.length === 0) {
                newPlayList = [musicItem];
            }
            if (newPlayList.length === 0) {
                return;
            }

            const now = Date.now();
            if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
                newPlayList = this.shrinkPlayListToSize(
                    newPlayList,
                    newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
                );
            }

            const writablePlayList = newPlayList.map((it, index) => ({
                ...it,
                [timeStampSymbol]: now,
                [sortIndexSymbol]: index,
            }));
            const targetMusic =
                writablePlayList.find(it => isSameMediaItem(it, musicItem)) ??
                {
                    ...musicItem,
                    [timeStampSymbol]: now,
                    [sortIndexSymbol]: 0,
                };

            this.setPlayList(
                this.repeatMode === MusicRepeatMode.SHUFFLE
                    ? shuffle(writablePlayList)
                    : writablePlayList,
            );
            trace("TrackPlayer.playWithReplacePlayList before play", {
                musicId: targetMusic.id,
                platform: targetMusic.platform,
                queuedLength: writablePlayList.length,
                currentIndex: this.currentIndex,
            });
            await this.play(targetMusic, true);
            trace("TrackPlayer.playWithReplacePlayList end", {
                musicId: targetMusic.id,
                platform: targetMusic.platform,
            });
        } catch (e: any) {
            trace("TrackPlayer.playWithReplacePlayList error", {
                musicId: musicItem?.id,
                platform: musicItem?.platform,
                message: e?.message ?? String(e ?? ""),
                stack: e?.stack,
            }, "error");
        }
    }

    async seekTo(progress: number) {
        PersistStatus.set("music.progress", progress);
        return this.backend.seekTo(progress);
    }

    getProgress = () => this.backend.getProgress();
    getRate = () => this.backend.getRate();
    setRate = (rate: number) => this.backend.setRate(rate);
    reset = () => this.backend.reset();


    /**************** 辅助函数 -- 设置内部状态 ****************/

    private setCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        // 设置UI内部状态的musicitem
        if (!musicItem) {
            this.currentIndex = -1;
            getDefaultStore().set(currentMusicAtom, null);
            PersistStatus.set("music.musicItem", undefined);
            PersistStatus.set("music.progress", 0);

            this.emit(TrackPlayerEvents.CurrentMusicChanged, null);
            return;
        }
        const normalizedMusicItem =
            typeof musicItem.artwork === "string"
                ? musicItem
                : {
                    ...musicItem,
                    artwork: ImgAsset.albumDefault,
                };
        this.currentIndex = this.getMusicIndexInPlayList(normalizedMusicItem);
        getDefaultStore().set(currentMusicAtom, normalizedMusicItem);
        PersistStatus.set("music.musicItem", normalizedMusicItem);

        this.emit(TrackPlayerEvents.CurrentMusicChanged, normalizedMusicItem);
    }

    private setRepeatMode(mode: MusicRepeatMode) {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[];
        const prevMode = getDefaultStore().get(repeatModeAtom);
        if (
            (prevMode === MusicRepeatMode.SHUFFLE &&
                mode !== MusicRepeatMode.SHUFFLE) ||
            (mode === MusicRepeatMode.SHUFFLE &&
                prevMode !== MusicRepeatMode.SHUFFLE)
        ) {
            if (mode === MusicRepeatMode.SHUFFLE) {
                newPlayList = shuffle(playList);
            } else {
                newPlayList = this.sortByTimestampAndIndex(playList, true);
            }
            this.setPlayList(newPlayList);
        }

        getDefaultStore().set(repeatModeAtom, mode);
        this.syncBackendRepeatMode().catch(error => {
            errorLog("同步播放循环模式失败", error?.message ?? error);
        });
        // 记录
        PersistStatus.set("music.repeatMode", mode);
    }

    private setQuality(quality: IMusic.IQualityKey) {
        getDefaultStore().set(qualityAtom, quality);
        PersistStatus.set("music.quality", quality);
    }

    private normalizeProgress(progress?: number | null) {
        return typeof progress === "number" && Number.isFinite(progress) && progress > 0
            ? progress
            : undefined;
    }

    private async ensureNitroAutoPlay(targetKey: string) {
        const retryDelays = [180, 520, 1100];
        for (let retryDelay of retryDelays) {
            await delay(retryDelay);

            const currentMusic = this.currentMusic;
            if (!currentMusic || getMediaUniqueKey(currentMusic) !== targetKey) {
                trace("Nitro 自动播放补偿取消", {
                    targetKey,
                    currentKey: currentMusic
                        ? getMediaUniqueKey(currentMusic)
                        : null,
                });
                return;
            }

            const activeTrack = await this.backend.getActiveTrack?.()
                .catch(() => null);
            const activeMusic = this.resolveMusicFromAdapterTrack(
                activeTrack as Partial<IMusic.IMusicItem> | null,
            );
            const activeKey = activeMusic
                ? getMediaUniqueKey(activeMusic)
                : null;
            if (activeKey && activeKey !== targetKey) {
                trace("Nitro 自动播放补偿等待目标曲", {
                    targetKey,
                    activeKey,
                });
                continue;
            }

            const state = await this.backend.getState().catch(() => "idle");
            if (state === "playing") {
                return;
            }

            trace("Nitro 自动播放补偿", {
                targetKey,
                state,
                retryDelay,
            });
            await this.backend.play();
        }
    }

    private resolveResumeSeekTime(musicItem: IMusic.IMusicItem) {
        const itemCurrentTime = this.normalizeProgress((musicItem as any)?._currentTime);
        if (itemCurrentTime) {
            return itemCurrentTime;
        }

        const progress = this.normalizeProgress(PersistStatus.get("music.progress"));
        if (!progress) {
            return undefined;
        }

        const persistedMusic = PersistStatus.get("music.musicItem");
        if (persistedMusic && !isSameMediaItem(musicItem, persistedMusic)) {
            return undefined;
        }

        return progress;
    }

    // 设置音源
    private async setTrackSource(track: MusicFreePlayerTrack, autoPlay = true, seekTo?: number) {
        const clonedTrack = this.patchMediaArtwork(track);
        if (!clonedTrack) {
            return;
        }
        const initialProgress = this.normalizeProgress(seekTo) ?? 0;
        clonedTrack.userAgent = clonedTrack.userAgent || getAppUserAgent();
        const nitroTargetKey = getMediaUniqueKey(clonedTrack as unknown as IMusic.IMusicItem);
        const nitroQueue = this.getNitroQueue(clonedTrack as unknown as IMusic.IMusicItem);
        this.nitroTrackChangeGuard = {
            key: nitroTargetKey,
            until: Date.now() + 5000,
        };
        await this.backend.loadQueue(
            nitroQueue.tracks,
            nitroQueue.startIndex,
        );
        await this.syncBackendRepeatMode();
        const startIndex = nitroQueue.startIndex;
        const lookaheadTracks =
            nitroQueue.tracks.slice(startIndex + 1, startIndex + 6);
        this.resolveNitroQueuedTracks(lookaheadTracks)
            .catch(error => {
                errorLog(
                    "Nitro 预解析下一首失败",
                    error?.message ?? error,
                );
            });
        PersistStatus.set("music.musicItem", track as IMusic.IMusicItem);
        PersistStatus.set("music.progress", initialProgress);
        const currentProgress = setPlayerProgress({
            position: initialProgress,
            duration: Number(track.duration) || 0,
            buffered: initialProgress,
        });
        this.emit(TrackPlayerEvents.ProgressChanged, currentProgress);
        if (autoPlay) {
            await this.backend.play();
            if (nitroTargetKey) {
                this.ensureNitroAutoPlay(nitroTargetKey).catch(error => {
                    errorLog(
                        "Nitro 自动播放补偿失败",
                        error?.message ?? error,
                    );
                });
            }
        }
        // [新增] 在开始播放后跳转到指定时间
        if (initialProgress > 0) {
            // 增加一个短暂延迟，确保播放器准备好接收 seek 命令
            await delay(100);
            await this.seekTo(initialProgress);
        }
    }

    /**
     * 设置播放队列
     * @param newPlayList 播放队列
     * @param persist 是否持久化
     */
    private setPlayList(newPlayList: IMusic.IMusicItem[], persist = true) {
        getDefaultStore().set(playListAtom, newPlayList);

        this.playListIndexMap = createMediaIndexMap(newPlayList);

        if (persist) {
            PersistStatus.set("music.playList", newPlayList);
        }

        this.currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
    }


    /**************** 辅助函数 -- 工具方法 ****************/
    private shrinkPlayListToSize = (
        queue: IMusic.IMusicItem[],
        targetIndex = this.currentIndex,
    ) => {
        // 播放列表上限，太多无法缓存状态
        if (queue.length > TrackPlayer.maxMusicQueueLength) {
            if (targetIndex < TrackPlayer.halfMaxMusicQueueLength) {
                queue = queue.slice(0, TrackPlayer.maxMusicQueueLength);
            } else {
                const right = Math.min(
                    queue.length,
                    targetIndex + TrackPlayer.halfMaxMusicQueueLength,
                );
                const left = Math.max(0, right - TrackPlayer.maxMusicQueueLength);
                queue = queue.slice(left, right);
            }
        }
        return queue;
    };

    private mergeTrackSource(
        mediaItem: ICommon.IMediaBase,
        props: Record<string, any> | undefined,
    ): ICommon.IMediaBase & Record<string, any> {
        const merged = {
            ...mediaItem,
            ...(props ?? {}),
            id: mediaItem.id,
            platform: mediaItem.platform,
        } as ICommon.IMediaBase & Record<string, any>;
        merged.userAgent = merged.userAgent || getAppUserAgent();
        return merged;
    }

    private isUnsupportedEncryptedSource(
        source?: {url?: string | null; ekey?: string | null} | null,
    ) {
        return hasEncryptedMediaSource(source?.url, source?.ekey);
    }

    private sortByTimestampAndIndex(array: any[], newArray = false) {
        if (newArray) {
            array = [...array];
        }
        return array.sort((a, b) => {
            const ts = a[timeStampSymbol] - b[timeStampSymbol];
            if (ts !== 0) {
                return ts;
            }
            return a[sortIndexSymbol] - b[sortIndexSymbol];
        });
    }

    private getPlayQualityOrder() {
        return getQualityOrder(
            this.configService.getConfig("basic.defaultPlayQuality") ?? "standard",
            this.configService.getConfig("basic.playQualityOrder") ?? "asc",
        );
    }

    private createNitroQueuedTrack(musicItem: IMusic.IMusicItem) {
        return this.patchMediaArtwork({
            ...musicItem,
            url: musicItem.url ?? "",
            userAgent: getAppUserAgent(),
            musicItem,
        } as unknown as MusicFreePlayerTrack) as MusicFreePlayerTrack;
    }

    private async syncNitroQueueInsert(
        musicItems: IMusic.IMusicItem[],
        index?: number,
    ) {
        if (!this.backend.addQueueTracks || musicItems.length === 0) {
            return;
        }
        await this.backend.addQueueTracks(
            musicItems.map(item => this.createNitroQueuedTrack(item)),
            index,
        );
    }

    private async syncNitroQueueRemove(musicItem: IMusic.IMusicItem) {
        if (!this.backend.removeQueueTrack) {
            return;
        }
        await this.backend.removeQueueTrack(
            this.createNitroQueuedTrack(musicItem),
        );
    }

    private getNitroQueue(currentTrack: IMusic.IMusicItem) {
        const fallbackTrack = this.patchMediaArtwork(
            currentTrack as unknown as MusicFreePlayerTrack,
        ) as MusicFreePlayerTrack;
        if (this.playList.length === 0) {
            return {
                tracks: [fallbackTrack],
                startIndex: 0,
            };
        }

        const startIndex = Math.max(
            0,
            this.getMusicIndexInPlayList(currentTrack),
        );
        const currentKey = getMediaUniqueKey(currentTrack);
        const tracks = this.playList.map(musicItem => {
            if (getMediaUniqueKey(musicItem) === currentKey) {
                return fallbackTrack;
            }
            return this.createNitroQueuedTrack(musicItem);
        });

        return {
            tracks,
            startIndex,
        };
    }

    private resolveMusicFromAdapterTrack(
        track?: Partial<IMusic.IMusicItem> | null,
    ) {
        if (!track?.platform || !track.id) {
            return null;
        }
        const index = this.playListIndexMap.getIndex(
            track as ICommon.IMediaBase,
        );
        return index >= 0 ? this.playList[index] : null;
    }

    private shouldIgnoreNitroTrackChange(evt: {
        track?: Partial<IMusic.IMusicItem> | null;
        index?: number;
        reason?: unknown;
    }) {
        const guard = this.nitroTrackChangeGuard;
        if (!guard) {
            return false;
        }
        if (Date.now() > guard.until) {
            this.nitroTrackChangeGuard = null;
            return false;
        }

        const musicItem = this.resolveMusicFromAdapterTrack(evt.track);
        const eventKey = musicItem ? getMediaUniqueKey(musicItem) : null;
        if (eventKey === guard.key) {
            return false;
        }

        trace("Nitro 队列切歌忽略", {
            index: evt.index,
            reason: evt.reason,
            eventMusicId: musicItem?.id,
            eventPlatform: musicItem?.platform,
            expectedKey: guard.key,
        });
        return true;
    }

    private async resolveDirectMediaSource(
        musicItem: IMusic.IMusicItem,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = this.getPlayQualityOrder();

        for (let quality of qualityOrder) {
            const candidate =
                (await plugin?.methods?.getMediaSource(
                    musicItem,
                    quality,
                )) ?? null;
            if (candidate?.url && !this.isUnsupportedEncryptedSource(candidate)) {
                return candidate;
            }
        }

        if (musicItem.source) {
            for (let quality of qualityOrder) {
                const legacyQuality = convertToLegacyQuality(quality);
                const directSource =
                    musicItem.source[quality] ??
                    (legacyQuality ? musicItem.source[legacyQuality] : undefined);
                if (
                    directSource?.url &&
                    !this.isUnsupportedEncryptedSource(directSource)
                ) {
                    return directSource;
                }
            }
        }

        if (musicItem.url) {
            return {
                url: musicItem.url,
                ekey: musicItem.ekey,
            };
        }

        return null;
    }

    private async resolveNitroQueuedTracks(
        tracks: Array<Partial<IMusic.IMusicItem>>,
    ) {
        for (let track of tracks) {
            const musicItem = this.resolveMusicFromAdapterTrack(track);
            if (!musicItem) {
                continue;
            }

            const key = getMediaUniqueKey(musicItem);
            if (this.nitroPendingSourceRequests.has(key)) {
                continue;
            }

            this.nitroPendingSourceRequests.add(key);
            try {
                const source = await this.resolveDirectMediaSource(musicItem);
                if (!source?.url) {
                    continue;
                }
                const updatedTrack = this.patchMediaArtwork(
                    this.mergeTrackSource(
                        musicItem,
                        source,
                    ) as unknown as MusicFreePlayerTrack,
                );
                if (updatedTrack) {
                    trace("Nitro 预解析音源成功", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                        sourceUrl: source.url,
                    });
                    await this.backend.updateTrack(updatedTrack);
                }
            } catch (error: any) {
                errorLog("Nitro 预解析音源失败", error?.message ?? error);
            } finally {
                this.nitroPendingSourceRequests.delete(key);
            }
        }
    }

    private async prepareNitroTrackSource(musicItem: IMusic.IMusicItem) {
        const source = await this.resolveDirectMediaSource(musicItem);
        if (!source?.url) {
            return null;
        }
        const updatedTrack = this.patchMediaArtwork(
            this.mergeTrackSource(
                musicItem,
                source,
            ) as unknown as MusicFreePlayerTrack,
        );
        if (updatedTrack) {
            await this.backend.updateTrack(updatedTrack);
        }
        return updatedTrack;
    }

    private syncNitroCurrentMusic(track?: Partial<IMusic.IMusicItem> | null) {
        const musicItem = this.resolveMusicFromAdapterTrack(track);
        if (!musicItem) {
            return null;
        }
        const syncedMusic = track?.url
            ? this.mergeTrackSource(musicItem, {
                url: track.url,
            }) as IMusic.IMusicItem
            : musicItem;
        this.setCurrentMusic(syncedMusic);
        PersistStatus.set("music.musicItem", syncedMusic);
        PersistStatus.set("music.progress", 0);
        setPlayerProgress({
            position: 0,
            duration: Number(syncedMusic.duration) || 0,
            buffered: 0,
        });
        return syncedMusic;
    }

    private getBackendRepeatMode(
        mode: MusicRepeatMode = this.repeatMode,
    ): PlayerAdapterRepeatMode {
        if (mode === MusicRepeatMode.SINGLE) {
            return "track";
        }
        return "queue";
    }

    private async syncBackendRepeatMode() {
        await this.backend.setRepeatMode?.(
            this.getBackendRepeatMode(),
        );
    }

    private handlePlayFail() {
        trace("Nitro 播放失败，不执行 JS 自动下一曲");
    }

    /**
 *
 * @param musicItem 音乐类型
 * @param type 媒体类型
 * @param abortFunction 如果函数为true，则中断
 * @returns
 */
    private async getSimilarMusic<T extends ICommon.SupportMediaType>(
        musicItem: IMusic.IMusicItem,
        type: T = "music" as T,
        abortFunction?: () => boolean,
    ): Promise<ICommon.SupportMediaItemBase[T] | null> {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManagerService.getSearchablePlugins(type);

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin;

        const startTime = Date.now();

        for (let plugin of plugins) {
            // 超时时间：8s
            if (abortFunction?.() || Date.now() - startTime > 8000) {
                break;
            }
            if (plugin.name === musicItem.platform) {
                continue;
            }
            const results = await plugin.methods
                .search(keyword, 1, type)
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (item.title === keyword && item.artist === musicItem.artist) {
                    distance = 0;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                    break;
                } else {
                    const dist =
                        minDistance(keyword, musicItem.title) +
                        minDistance(item.artist, musicItem.artist);
                    if (dist < distance) {
                        distance = dist;
                        minDistanceMusicItem = item;
                        targetPlugin = plugin;
                    }
                }
            }

            if (distance === 0) {
                break;
            }
        }
        if (minDistanceMusicItem && targetPlugin) {
            return minDistanceMusicItem as ICommon.SupportMediaItemBase[T];
        }

        return null;
    }


    private patchMediaArtwork(track: MusicFreePlayerTrack) {
        // Bug: React native track player 在设置音频时，artwork不能为null，并且部分情况下artwork不能为ImageSource类型
        if (!track) {
            return null;
        }
        return {
            ...track,
            artwork: resolveImportedAssetOrPath(
                track.artwork?.trim?.()?.length ? track.artwork : ImgAsset.albumDefault,
            ) as unknown as any,
        };
    }

}

export const usePlayList = () => useAtomValue(playListAtom);
export const useCurrentMusic = () => useAtomValue(currentMusicAtom);
export const useRepeatMode = () => useAtomValue(repeatModeAtom);
export const useMusicQuality = () => useAtomValue(qualityAtom);
export function useMusicState() {
    const musicState = useAtomValue(musicStateAtom);

    useEffect(() => {
        let cancelled = false;
        trackPlayer.playerAdapter.getState().then(state => {
            if (!cancelled) {
                getDefaultStore().set(musicStateAtom, state);
            }
        }).catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    return musicState;
}

export function useProgress(_updateInterval?: number) {
    const progress = useAtomValue(progressAtom);

    useEffect(() => {
        let cancelled = false;
        trackPlayer.getProgress().then(currentProgress => {
            if (!cancelled) {
                setPlayerProgress(
                    currentProgress,
                    trackPlayer.currentMusic?.duration ?? 0,
                );
            }
        }).catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    return progress;
}
export type { PlayerBackendState as MusicState };

enum PlayFailReason {
    /** 禁止移动网络播放 */
    FORBID_CELLUAR_NETWORK_PLAY = "FORBID_CELLUAR_NETWORK_PLAY",
    /** 播放列表为空 */
    PLAY_LIST_IS_EMPTY = "PLAY_LIST_IS_EMPTY",
    /** 无效源 */
    INVALID_SOURCE = "INVALID_SOURCE",
    /** 非当前音乐 */
}

const trackPlayer = new TrackPlayer();
export default trackPlayer;
