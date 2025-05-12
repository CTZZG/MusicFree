import { getCurrentDialog, showDialog } from '@/components/dialogs/useDialog';
import {
    internalFakeSoundKey,
    sortIndexSymbol,
    timeStampSymbol,
} from '@/constants/commonConst';
import { MusicRepeatMode } from '@/constants/repeatModeConst';
import delay from '@/utils/delay';
import getSimilarMusic from '@/utils/getSimilarMusic';
import getUrlExt from '@/utils/getUrlExt';
import { errorLog, trace } from '@/utils/log';
import { createMediaIndexMap } from '@/utils/mediaIndexMap';
import {
    getLocalPath,
    isSameMediaItem,
} from '@/utils/mediaUtils';
import Network from '@/utils/network';
import PersistStatus from '@/utils/persistStatus';
import { getQualityOrder } from '@/utils/qualities';
import { musicIsPaused } from '@/utils/trackUtils';
import EventEmitter from 'eventemitter3';
import { produce } from 'immer';
import { atom, getDefaultStore, useAtomValue } from 'jotai';
import shuffle from 'lodash.shuffle';
import ReactNativeTrackPlayer, {
    Event,
    State,
    Track,
    TrackMetadataBase,
    usePlaybackState,
    useProgress,
} from 'react-native-track-player';
import LocalMusicSheet from '../localMusicSheet';
import PluginManager from '../pluginManager';

import type { IAppConfig } from '@/types/core/config';
import type { IMusicHistory } from '@/types/core/musicHistory';
import { ITrackPlayer } from '@/types/core/trackPlayer/index';
import { TrackPlayerEvents } from '@/core.defination/trackPlayer';
import { getAppUserAgent } from '@/utils/userAgentHelper'; // <--- 新增导入

const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
const repeatModeAtom = atom<MusicRepeatMode>(MusicRepeatMode.QUEUE);
const qualityAtom = atom<IMusic.IQualityKey>('standard');
const playListAtom = atom<IMusic.IMusicItem[]>([]);


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

    // 当前播放的音乐下标
    private currentIndex = -1;
    // 音乐播放器服务是否启动
    private serviceInited = false;
    // 播放队列索引map
    private playListIndexMap = createMediaIndexMap([] as IMusic.IMusicItem[]);


    private static maxMusicQueueLength = 10000;
    private static halfMaxMusicQueueLength = 5000;
    private static toggleRepeatMapping = {
        [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
        [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
        [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
    };
    private static fakeAudioUrl = "musicfree://fake-audio";
    private static proposedAudioUrl = "musicfree://proposed-audio";

    constructor() {
        super();
    }

    public get previousMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex - 1); // <--- 修正: 应该是 this.currentIndex - 1
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


    injectDependencies(configService: IAppConfig, musicHistoryService: IMusicHistory): void { // <--- 修正 musicHistoryService 类型
        this.configService = configService;
        this.musicHistoryService = musicHistoryService;
    }


    async setupTrackPlayer() {
        const rate = PersistStatus.get('music.rate');
        const musicQueue = PersistStatus.get('music.playList');
        const repeatMode = PersistStatus.get('music.repeatMode');
        const progress = PersistStatus.get('music.progress');
        let track = PersistStatus.get('music.musicItem'); // <--- 改为 let
        const quality =
            PersistStatus.get('music.quality') ||
            this.configService.getConfig('basic.defaultPlayQuality') ||
            'standard';

        if (rate) {
            ReactNativeTrackPlayer.setRate(+rate / 100);
        }
        if (repeatMode) {
            getDefaultStore().set(repeatModeAtom, repeatMode as MusicRepeatMode);
        }

        if (musicQueue && Array.isArray(musicQueue)) {
            this.addAll(
                musicQueue,
                undefined,
                repeatMode === MusicRepeatMode.SHUFFLE,
            );
        }

        if (track && this.isInPlayList(track)) {
            if (!this.configService.getConfig('basic.autoPlayWhenAppStart')) {
                // @ts-ignore
                track.isInit = true;
            }
            // @ts-ignore <--- 添加 UA
            track.userAgent = getAppUserAgent();


            PluginManager.getByMedia(track)
                ?.methods.getMediaSource(track, quality, 0)
                .then(async newSource => {
                    // @ts-ignore
                    track.url = newSource?.url || track.url;
                    // @ts-ignore
                    track.headers = newSource?.headers || track.headers;
                     // @ts-ignore <--- 再次确保 UA
                    track.userAgent = getAppUserAgent();


                    if (isSameMediaItem(this.currentMusic, track)) {
                        await this.setTrackSource(track as Track, false);
                    }
                });
            this.setCurrentMusic(track);

            if (progress) {
                ReactNativeTrackPlayer.seekTo(progress);
            }
        }

        if (!this.serviceInited) {
            ReactNativeTrackPlayer.addEventListener(
                Event.PlaybackActiveTrackChanged,
                async evt => {
                    if (
                        evt.index === 1 &&
                        evt.lastIndex === 0 &&
                        evt.track?.url === TrackPlayer.fakeAudioUrl
                    ) {
                        trace('队列末尾，播放下一首');
                        this.emit(TrackPlayerEvents.PlayEnd);
                        if (
                            this.repeatMode ===
                            MusicRepeatMode.SINGLE
                        ) {
                            await this.play(null, true);
                        } else {
                            await this.skipToNext();
                        }
                    }
                },
            );

            ReactNativeTrackPlayer.addEventListener(
                Event.PlaybackError,
                async e => {
                    errorLog('播放出错', e.message);
                    const currentTrack =
                        await ReactNativeTrackPlayer.getActiveTrack();
                    // @ts-ignore
                    if (currentTrack?.isInit) {
                        ReactNativeTrackPlayer.updateMetadataForTrack(0, {
                            ...currentTrack,
                            // @ts-ignore
                            isInit: undefined,
                            userAgent: getAppUserAgent(), // <--- 添加UA
                        });
                        return;
                    }

                    if (
                        currentTrack?.url !== TrackPlayer.fakeAudioUrl && currentTrack?.url !== TrackPlayer.proposedAudioUrl &&
                        (await ReactNativeTrackPlayer.getActiveTrackIndex()) === 0 &&
                        e.message &&
                        e.message !== 'android-io-file-not-found'
                    ) {
                        trace('播放出错', {
                            message: e.message,
                            code: e.code,
                        });
                        this.handlePlayFail();
                    }
                },
            );
            this.serviceInited = true;
        }
    }

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

    isPlayListEmpty() {
        return this.playList.length === 0;
    }

    addAll(
        musicItems: Array<IMusic.IMusicItem>,
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): void {
        const now = Date.now();
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentPlayList = this.playList;
        musicItems.forEach((item, index) => {
            item[timeStampSymbol] = now;
            item[sortIndexSymbol] = index;
        });

        if (beforeIndex === undefined || beforeIndex < 0) {
            newPlayList = currentPlayList.concat(
                musicItems.filter(item => !this.isInPlayList(item)),
            );
        } else {
            const indexMap = createMediaIndexMap(musicItems);
            const beforeDraft = currentPlayList
                .slice(0, beforeIndex)
                .filter(item => !indexMap.has(item));
            const afterDraft = currentPlayList
                .slice(beforeIndex)
                .filter(item => !indexMap.has(item));
            newPlayList = [...beforeDraft, ...musicItems, ...afterDraft];
        }

        if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
            newPlayList = this.shrinkPlayListToSize(
                newPlayList,
                beforeIndex ?? newPlayList.length - 1,
            );
        }

        if (shouldShuffle) {
            newPlayList = shuffle(newPlayList);
        }
        this.setPlayList(newPlayList);

        if (this.currentMusic) {
            this.currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
        }
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
        this.add(musicItem, this.currentIndex + 1);
        const shouldAutoPlay = this.isPlayListEmpty(); // <--- 应该是判断添加前是否为空，或者第一个添加的自动播放
        if (shouldAutoPlay && this.playList.length > 0) { // <--- 修正逻辑
             this.play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
        }
    }

    async remove(musicItem: IMusic.IMusicItem): Promise<void> {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentMusic: IMusic.IMusicItem | null = this.currentMusic;
        const targetIndex = this.getMusicIndexInPlayList(musicItem);
        let shouldPlayCurrent: boolean | null = null;

        if (targetIndex === -1) return;

        if (this.currentIndex === targetIndex) {
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            if (newPlayList.length === 0) {
                currentMusic = null;
                shouldPlayCurrent = false;
            } else {
                currentMusic = newPlayList[this.currentIndex % newPlayList.length];
                try {
                    const state = (await ReactNativeTrackPlayer.getPlaybackState()).state;
                    shouldPlayCurrent = !musicIsPaused(state);
                } catch {
                    shouldPlayCurrent = false;
                }
            }
            this.setCurrentMusic(currentMusic); // <--- 将setCurrentMusic移到条件块外，确保始终更新
        } else {
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
            await ReactNativeTrackPlayer.reset();
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
            if (!musicItem) {
                musicItem = this.currentMusic;
            }
            if (!musicItem) {
                throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
            }
            const localPath = getLocalPath(musicItem);
            if (
                Network.isCellular &&
                !this.configService.getConfig('basic.useCelluarNetworkPlay') &&
                !LocalMusicSheet.isLocalMusic(musicItem) &&
                !localPath
            ) {
                await ReactNativeTrackPlayer.reset();
                throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
            }

            if (this.isCurrentMusic(musicItem)) {
                const currentTrack = await ReactNativeTrackPlayer.getTrack(0);
                if (
                    currentTrack?.url &&
                    isSameMediaItem(musicItem, currentTrack as IMusic.IMusicItem)
                ) {
                    const currentActiveIndex = await ReactNativeTrackPlayer.getActiveTrackIndex();
                    if (currentActiveIndex !== 0) {
                        await ReactNativeTrackPlayer.skip(0);
                    }
                    if (forcePlay) {
                        await ReactNativeTrackPlayer.seekTo(0);
                    }
                    const currentState = (await ReactNativeTrackPlayer.getPlaybackState()).state;
                    if (currentState === State.Stopped) {
                        await this.setTrackSource(currentTrack);
                    }
                    if (currentState !== State.Playing) {
                        await ReactNativeTrackPlayer.play();
                    }
                    return;
                }
            }

            const inPlayList = this.isInPlayList(musicItem);
            if (!inPlayList) {
                this.add(musicItem);
            }

            this.setCurrentMusic(musicItem);
            await ReactNativeTrackPlayer.setQueue([{
                ...musicItem,
                url: TrackPlayer.proposedAudioUrl,
                userAgent: getAppUserAgent(), // <--- 设置UA
            }, this.getFakeNextTrack()]);


            this.emit(TrackPlayerEvents.ProgressChanged, { position: 0, duration: musicItem.duration || 0 });


            let track: IMusic.IMusicItem;
            const plugin = PluginManager.getByName(musicItem.platform);
            const qualityOrder = getQualityOrder(
                this.configService.getConfig('basic.defaultPlayQuality') ?? 'standard',
                this.configService.getConfig('basic.playQualityOrder') ?? 'asc',
            );
            let source: IPlugin.IMediaSourceResult | null = null;
            for (let quality of qualityOrder) {
                if (this.isCurrentMusic(musicItem)) {
                    source = (await plugin?.methods?.getMediaSource(musicItem, quality)) ?? null;
                    if (source) {
                        this.setQuality(quality);
                        break;
                    }
                } else {
                    return;
                }
            }

            if (!this.isCurrentMusic(musicItem)) return;

            if (!source) {
                if (musicItem.source) {
                    for (let quality of qualityOrder) {
                        if (musicItem.source[quality]?.url) {
                            source = musicItem.source[quality]!;
                            this.setQuality(quality);
                            break;
                        }
                    }
                }
                if (!source && !musicItem.url) {
                    if (this.configService.getConfig('basic.tryChangeSourceWhenPlayFail')) {
                        const similarMusic = await getSimilarMusic(musicItem, 'music', () => !this.isCurrentMusic(musicItem));
                        if (similarMusic) {
                            const similarMusicPlugin = PluginManager.getByMedia(similarMusic);
                            for (let quality of qualityOrder) {
                                if (this.isCurrentMusic(musicItem)) {
                                    source = (await similarMusicPlugin?.methods?.getMediaSource(similarMusic, quality)) ?? null;
                                    if (source) {
                                        this.setQuality(quality);
                                        break;
                                    }
                                } else { return; }
                            }
                        }
                        if (!source) throw new Error(PlayFailReason.INVALID_SOURCE);
                    } else {
                        throw new Error(PlayFailReason.INVALID_SOURCE);
                    }
                } else if (!source) { // musicItem.url exists but source is still null
                    source = { url: musicItem.url };
                    this.setQuality('standard');
                }
            }

            if (getUrlExt(source.url) === '.m3u8') {
                // @ts-ignore
                source.type = 'hls';
            }
            track = this.mergeTrackSource(musicItem, source) as IMusic.IMusicItem;
            // @ts-ignore
            track.userAgent = getAppUserAgent(); // <--- 确保UA

            this.musicHistoryService.addMusic(musicItem);
            trace('获取音源成功', track);
            await this.setTrackSource(track as Track);

            let info: Partial<IMusic.IMusicItem> | null = null;
            try {
                info = (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
                if ((typeof info?.url === 'string' && info.url.trim() === '') || (info?.url && typeof info.url !== 'string')) {
                    delete info.url;
                }
            } catch { }

            if (info && this.isCurrentMusic(musicItem)) {
                const mergedTrack = this.mergeTrackSource(track, info);
                // @ts-ignore
                mergedTrack.userAgent = getAppUserAgent(); // <--- 再次确保UA
                getDefaultStore().set(currentMusicAtom, mergedTrack as IMusic.IMusicItem);
                await ReactNativeTrackPlayer.updateMetadataForTrack(0, mergedTrack as TrackMetadataBase);
            }
        } catch (e: any) {
            const message = e?.message;
            if (message === 'The player is not initialized. Call setupPlayer first.') {
                await ReactNativeTrackPlayer.setupPlayer();
                this.play(musicItem, forcePlay);
            } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
                if (getCurrentDialog()?.name !== 'SimpleDialog') {
                    showDialog('SimpleDialog', {
                        title: '流量提醒',
                        content: '当前非WIFI环境，侧边栏设置中打开【使用移动网络播放】功能后可继续播放',
                    });
                }
            } else if (message === PlayFailReason.INVALID_SOURCE) {
                trace('音源为空，播放失败');
                await this.handlePlayFail();
            } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
                //
            }
        }
    }

    async pause(): Promise<void> {
        await ReactNativeTrackPlayer.pause();
    }

    toggleRepeatMode(): void {
        this.setRepeatMode(TrackPlayer.toggleRepeatMapping[this.repeatMode]);
    }

    async clearPlayList(): Promise<void> {
        this.setPlayList([]);
        this.setCurrentMusic(null);
        await ReactNativeTrackPlayer.reset();
        PersistStatus.set('music.musicItem', undefined);
        PersistStatus.set('music.progress', 0);
    }

    async skipToNext(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }
        await this.play(this.getPlayListMusicAt(this.currentIndex + 1), true);
    }

    async skipToPrevious(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }
        await this.play(this.getPlayListMusicAt(this.currentIndex === -1 ? 0 : this.currentIndex - 1), true);
    }

    async changeQuality(newQuality: IMusic.IQualityKey): Promise<boolean> {
        if (newQuality === this.quality) return true;

        const musicItem = this.currentMusic;
        if (!musicItem) return false;

        try {
            const progress = await ReactNativeTrackPlayer.getProgress();
            const plugin = PluginManager.getByMedia(musicItem);
            const newSource = await plugin?.methods?.getMediaSource(musicItem, newQuality);
            if (!newSource?.url) throw new Error(PlayFailReason.INVALID_SOURCE);

            if (this.isCurrentMusic(musicItem)) {
                const playingState = (await ReactNativeTrackPlayer.getPlaybackState()).state;
                const trackToPlay = this.mergeTrackSource(musicItem, newSource) as unknown as Track;
                trackToPlay.userAgent = getAppUserAgent(); // <--- 设置UA
                await this.setTrackSource(trackToPlay, !musicIsPaused(playingState));
                await ReactNativeTrackPlayer.seekTo(progress.position ?? 0);
                this.setQuality(newQuality);
            }
            return true;
        } catch {
            return false;
        }
    }

    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
    ): Promise<void> {
        if (newPlayList.length !== 0) {
            const now = Date.now();
            if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
                newPlayList = this.shrinkPlayListToSize(
                    newPlayList,
                    newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
                );
            }

            newPlayList.forEach((it, index) => {
                it[timeStampSymbol] = now;
                it[sortIndexSymbol] = index;
            });

            this.setPlayList(
                this.repeatMode === MusicRepeatMode.SHUFFLE
                    ? shuffle(newPlayList)
                    : newPlayList,
            );
            await this.play(musicItem, true);
        }
    }

    getProgress = ReactNativeTrackPlayer.getProgress;
    getRate = ReactNativeTrackPlayer.getRate;
    setRate = ReactNativeTrackPlayer.setRate;
    seekTo = ReactNativeTrackPlayer.seekTo;
    reset = ReactNativeTrackPlayer.reset;

    private setCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            this.currentIndex = -1;
            getDefaultStore().set(currentMusicAtom, null);
            PersistStatus.set('music.musicItem', undefined);
            PersistStatus.set('music.progress', 0);
            this.emit(TrackPlayerEvents.CurrentMusicChanged, null);
            return;
        }
        this.currentIndex = this.getMusicIndexInPlayList(musicItem);
        getDefaultStore().set(currentMusicAtom, musicItem);
        this.emit(TrackPlayerEvents.CurrentMusicChanged, musicItem);
    }

    private setRepeatMode(mode: MusicRepeatMode) {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[];
        const prevMode = getDefaultStore().get(repeatModeAtom);
        if (
            (prevMode === MusicRepeatMode.SHUFFLE && mode !== MusicRepeatMode.SHUFFLE) ||
            (mode === MusicRepeatMode.SHUFFLE && prevMode !== MusicRepeatMode.SHUFFLE)
        ) {
            if (mode === MusicRepeatMode.SHUFFLE) {
                newPlayList = shuffle(playList);
            } else {
                newPlayList = this.sortByTimestampAndIndex(playList, true);
            }
            this.setPlayList(newPlayList);
        }

        const currentMusicItem = this.currentMusic;
        this.currentIndex = this.getMusicIndexInPlayList(currentMusicItem);
        getDefaultStore().set(repeatModeAtom, mode);
        ReactNativeTrackPlayer.updateMetadataForTrack(1, this.getFakeNextTrack());
        PersistStatus.set('music.repeatMode', mode);
    }

    private setQuality(quality: IMusic.IQualityKey) {
        getDefaultStore().set(qualityAtom, quality);
        PersistStatus.set('music.quality', quality);
    }

    private async setTrackSource(track: Track, autoPlay = true) {
        if (!track.artwork?.trim()?.length) {
            track.artwork = undefined;
        }
        track.userAgent = getAppUserAgent(); // <--- 确保设置UA
        await ReactNativeTrackPlayer.setQueue([track, this.getFakeNextTrack()]);
        PersistStatus.set('music.musicItem', track as IMusic.IMusicItem);
        PersistStatus.set('music.progress', 0);
        if (autoPlay) {
            await ReactNativeTrackPlayer.play();
        }
    }

    private setPlayList(newPlayList: IMusic.IMusicItem[], persist = true) {
        getDefaultStore().set(playListAtom, newPlayList);
        this.playListIndexMap = createMediaIndexMap(newPlayList);
        if (persist) {
            PersistStatus.set('music.playList', newPlayList);
        }
    }

    private shrinkPlayListToSize = (
        queue: IMusic.IMusicItem[],
        targetIndex = this.currentIndex,
    ) => {
        if (queue.length > TrackPlayer.maxMusicQueueLength) {
            if (targetIndex < TrackPlayer.halfMaxMusicQueueLength) {
                queue = queue.slice(0, TrackPlayer.maxMusicQueueLength);
            } else {
                const right = Math.min(queue.length, targetIndex + TrackPlayer.halfMaxMusicQueueLength);
                const left = Math.max(0, right - TrackPlayer.maxMusicQueueLength);
                queue = queue.slice(left, right);
            }
        }
        return queue;
    }

    private mergeTrackSource(
        mediaItem: ICommon.IMediaBase,
        props: Record<string, any> | undefined,
    ) {
        const merged = props
            ? {
                ...mediaItem,
                ...props,
                id: mediaItem.id,
                platform: mediaItem.platform,
            }
            : mediaItem;
        // @ts-ignore
        merged.userAgent = getAppUserAgent(); // <--- 确保UA
        return merged;
    }

    private sortByTimestampAndIndex(array: any[], newArray = false) {
        if (newArray) {
            array = [...array];
        }
        return array.sort((a, b) => {
            const ts = a[timeStampSymbol] - b[timeStampSymbol];
            if (ts !== 0) return ts;
            return a[sortIndexSymbol] - b[sortIndexSymbol];
        });
    }

    private getFakeNextTrack() {
        let track: Track | undefined;
        const repeatMode = this.repeatMode;
        if (repeatMode === MusicRepeatMode.SINGLE) {
            track = this.getPlayListMusicAt(this.currentIndex) as Track | undefined;
        } else {
            track = this.getPlayListMusicAt(this.currentIndex + 1) as Track | undefined;
        }

        const appUA = getAppUserAgent();

        if (track) {
            return produce(track, _ => {
                _.url = TrackPlayer.fakeAudioUrl;
                // @ts-ignore
                _.$ = internalFakeSoundKey;
                if (!_.artwork?.trim()?.length) {
                    _.artwork = undefined;
                }
                _.userAgent = appUA;
            });
        } else {
            return {
                url: TrackPlayer.fakeAudioUrl,
                $: internalFakeSoundKey,
                userAgent: appUA,
            } as Track;
        }
    }

    private async handlePlayFail() {
        if (!this.configService.getConfig('basic.autoStopWhenError')) {
            await ReactNativeTrackPlayer.reset(); // <--- 确保先reset
            await delay(500);
            await this.skipToNext();
        }
    }
}

export const usePlayList = () => useAtomValue(playListAtom);
export const useCurrentMusic = () => useAtomValue(currentMusicAtom);
export const useRepeatMode = () => useAtomValue(repeatModeAtom);
export const useMusicQuality = () => useAtomValue(qualityAtom);
export function useMusicState() {
    const playbackState = usePlaybackState();
    return playbackState.state;
}
export { State as MusicState, useProgress };

enum PlayFailReason {
    FORBID_CELLUAR_NETWORK_PLAY = 'FORBID_CELLUAR_NETWORK_PLAY',
    PLAY_LIST_IS_EMPTY = 'PLAY_LIST_IS_EMPTY',
    INVALID_SOURCE = 'INVALID_SOURCE',
}

const trackPlayer = new TrackPlayer();
export default trackPlayer;
