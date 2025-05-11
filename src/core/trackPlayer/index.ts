import { produce } from "immer";
import ReactNativeTrackPlayer, {
    Event,
    State,
    Track,
    TrackMetadataBase,
    usePlaybackState,
    useProgress
} from "react-native-track-player";
import shuffle from "lodash.shuffle";
import Config from "../config.ts";
import { EDeviceEvents, internalFakeSoundKey, sortIndexSymbol, timeStampSymbol } from "@/constants/commonConst";
import { GlobalState } from "@/utils/stateMapper";
import delay from "@/utils/delay";
import {
    getInternalData,
    InternalDataType,
    isSameMediaItem,
    mergeProps,
    sortByTimestampAndIndex
} from "@/utils/mediaItem";
import Network from "../network";
import LocalMusicSheet from "../localMusicSheet";
// import { SoundAsset } from "@/constants/assetsConst"; // Original, replaced by fakeAudioUrl
import { getQualityOrder } from "@/utils/qualities";
import musicHistory from "../musicHistory";
import getUrlExt from "@/utils/getUrlExt";
import { DeviceEventEmitter, Platform } from "react-native"; // Added Platform
import LyricManager from "../lyricManager";
import { MusicRepeatMode } from "./common"; // Assuming this is the original MusicRepeatMode enum location
import {
    getMusicIndex,
    getPlayList,
    getPlayListMusicAt,
    isInPlayList,
    isPlayListEmpty,
    setPlayList,
    usePlayList
} from "./internal/playList";
import { createMediaIndexMap } from "@/utils/mediaIndexMap";
import PluginManager from "../pluginManager";
import { musicIsPaused } from "@/utils/trackUtils";
import { errorLog, trace } from "@/utils/log";
import PersistStatus from "../persistStatus.ts";
import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog";
import getSimilarMusic from "@/utils/getSimilarMusic";
import MediaExtra from "@/core/mediaExtra.ts";
import DeviceInfo from 'react-native-device-info'; // Added DeviceInfo
import { getAppUserAgent } from '@/utils/userAgentHelper'; // Added getAppUserAgent

/** 当前播放 */
const currentMusicStore = new GlobalState<IMusic.IMusicItem | null>(null);

/** 播放模式 */
const repeatModeStore = new GlobalState<MusicRepeatMode>(MusicRepeatMode.QUEUE);

/** 音质 */
const qualityStore = new GlobalState<IMusic.IQualityKey>('standard');

let currentIndex = -1;

const maxMusicQueueLength = 10000; // 当前播放最大限制
const halfMaxMusicQueueLength = Math.floor(maxMusicQueueLength / 2);
const shrinkPlayListToSize = (
    queue: IMusic.IMusicItem[],
    targetIndex = currentIndex,
) => {
    // 播放列表上限，太多无法缓存状态
    if (queue.length > maxMusicQueueLength) {
        if (targetIndex < halfMaxMusicQueueLength) {
            queue = queue.slice(0, maxMusicQueueLength);
        } else {
            const right = Math.min(
                queue.length,
                targetIndex + halfMaxMusicQueueLength,
            );
            const left = Math.max(0, right - maxMusicQueueLength);
            queue = queue.slice(left, right);
        }
    }
    return queue;
};

let hasSetupListener = false;

// Define these constants, similar to the proposed solution
const fakeAudioUrl = "musicfree://fake-audio";
const proposedAudioUrl = "musicfree://proposed-audio";


async function setupTrackPlayer() {
    const rate = PersistStatus.get('music.rate');
    const musicQueue = PersistStatus.get('music.playList');
    const repeatMode = PersistStatus.get('music.repeatMode');
    const progress = PersistStatus.get('music.progress');
    const track = PersistStatus.get('music.musicItem');
    const quality =
        PersistStatus.get('music.quality') ||
        Config.getConfig('basic.defaultPlayQuality') ||
        'standard';

    // 状态恢复
    if (rate) {
        ReactNativeTrackPlayer.setRate(+rate / 100);
    }
    if (repeatMode) {
        repeatModeStore.setValue(repeatMode as MusicRepeatMode);
    }

    if (musicQueue && Array.isArray(musicQueue)) {
        addAll(musicQueue, undefined, repeatMode === MusicRepeatMode.SHUFFLE);
    }

    if (track && isInPlayList(track)) {
        if (!Config.getConfig('basic.autoPlayWhenAppStart')) {
            (track as any).isInit = true; // Keep isInit for compatibility if used
        }

        // 异步
        PluginManager.getByMedia(track)
            ?.methods.getMediaSource(track, quality, 0)
            .then(async newSource => {
                track.url = newSource?.url || track.url;
                track.headers = newSource?.headers || track.headers;
                (track as any).userAgent = getAppUserAgent(); // Ensure UA is set before potential setTrackSource

                if (isSameMediaItem(currentMusicStore.getValue(), track)) {
                    await setTrackSource(track as Track, false);
                }
            });
        setCurrentMusic(track);

        if (progress) {
            // 异步
            ReactNativeTrackPlayer.seekTo(progress);
        }
    }

    if (!hasSetupListener) {
        ReactNativeTrackPlayer.addEventListener(
            Event.PlaybackActiveTrackChanged,
            async evt => {
                if (
                    evt.index === 1 &&
                    evt.lastIndex === 0 &&
                    (evt.track as any)?.$ === internalFakeSoundKey // Check against the defined key
                ) {
                    trace('队列末尾，播放下一首');
                    if (repeatModeStore.getValue() === MusicRepeatMode.SINGLE) {
                        await play(null, true);
                    } else {
                        // 当前生效的歌曲是下一曲的标记
                        await skipToNext();
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
                if ((currentTrack as any)?.isInit) { // Keep isInit check
                    ReactNativeTrackPlayer.updateMetadataForTrack(0, {
                        ...currentTrack,
                        isInit: undefined,
                    } as TrackMetadataBase);
                    return;
                }

                if (
                    currentTrack?.url !== fakeAudioUrl && // Compare with defined constant
                    currentTrack?.url !== proposedAudioUrl &&
                    (await ReactNativeTrackPlayer.getActiveTrackIndex()) === 0 &&
                    e.message &&
                    e.message !== 'android-io-file-not-found'
                ) {
                    trace('播放出错', {
                        message: e.message,
                        code: e.code,
                    });

                    failToPlay();
                }
            },
        );

        hasSetupListener = true;
    }
}

const getFakeNextTrack = (): Track => {
    let track: Track | undefined;
    const repeatMode = repeatModeStore.getValue();
    if (repeatMode === MusicRepeatMode.SINGLE) {
        track = getPlayListMusicAt(currentIndex) as Track | undefined;
    } else {
        track = getPlayListMusicAt(currentIndex + 1) as Track | undefined;
    }

    const appUA = getAppUserAgent();

    if (track) {
        return produce(track, _ => {
            _.url = fakeAudioUrl; // Use defined constant
            (_ as any).$ = internalFakeSoundKey;
            if (!_.artwork?.trim()?.length) {
                _.artwork = undefined;
            }
            _.userAgent = appUA;
        });
    } else {
        return {
            url: fakeAudioUrl, // Use defined constant
            $: internalFakeSoundKey,
            userAgent: appUA,
        } as Track;
    }
};

async function failToPlay() {
    if (!Config.getConfig('basic.autoStopWhenError')) {
        await ReactNativeTrackPlayer.reset();
        await delay(500);
        await skipToNext();
    }
}

const _toggleRepeatMapping = {
    [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
    [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
    [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
};
const toggleRepeatMode = () => {
    setRepeatMode(_toggleRepeatMapping[repeatModeStore.getValue()]);
};

const addAll = (
    musicItems: Array<IMusic.IMusicItem> = [],
    beforeIndex?: number,
    shouldShuffle?: boolean,
) => {
    const now = Date.now();
    let newPlayList: IMusic.IMusicItem[] = [];
    let currentPlayList = getPlayList();
    musicItems.forEach((item, index) => {
        item[timeStampSymbol] = now;
        item[sortIndexSymbol] = index;
    });

    if (beforeIndex === undefined || beforeIndex < 0) {
        newPlayList = currentPlayList.concat(
            musicItems.filter(item => !isInPlayList(item)),
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

    if (newPlayList.length > maxMusicQueueLength) {
        newPlayList = shrinkPlayListToSize(
            newPlayList,
            beforeIndex ?? newPlayList.length - 1,
        );
    }

    if (shouldShuffle) {
        newPlayList = shuffle(newPlayList);
    }
    setPlayList(newPlayList);
    const currentMusicItem = currentMusicStore.getValue();
    if (currentMusicItem) {
        currentIndex = getMusicIndex(currentMusicItem);
    }
};

const add = (
    musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
    beforeIndex?: number,
) => {
    addAll(Array.isArray(musicItem) ? musicItem : [musicItem], beforeIndex);
};

const addNext = (musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) => {
    const shouldPlay = isPlayListEmpty();
    add(musicItem, currentIndex + 1);
    if (shouldPlay) {
        play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
    }
};

const isCurrentMusic = (musicItem: IMusic.IMusicItem | null | undefined) => {
    return isSameMediaItem(musicItem, currentMusicStore.getValue()) ?? false;
};

const remove = async (musicItem: IMusic.IMusicItem) => {
    const playList = getPlayList();
    let newPlayList: IMusic.IMusicItem[] = [];
    let currentMusic: IMusic.IMusicItem | null = currentMusicStore.getValue();
    const targetIndex = getMusicIndex(musicItem);
    let shouldPlayCurrent: boolean | null = null;
    if (targetIndex === -1) {
        return;
    }
    if (currentIndex === targetIndex) {
        newPlayList = produce(playList, draft => {
            draft.splice(targetIndex, 1);
        });
        if (newPlayList.length === 0) {
            currentMusic = null;
            shouldPlayCurrent = false;
        } else {
            currentMusic = newPlayList[currentIndex % newPlayList.length];
            try {
                const state = (await ReactNativeTrackPlayer.getPlaybackState())
                    .state;
                shouldPlayCurrent = !musicIsPaused(state);
            } catch {
                shouldPlayCurrent = false;
            }
        }
    } else {
        newPlayList = produce(playList, draft => {
            draft.splice(targetIndex, 1);
        });
    }

    setPlayList(newPlayList);
    setCurrentMusic(currentMusic);
    if (shouldPlayCurrent === true) {
        await play(currentMusic, true);
    } else if (shouldPlayCurrent === false) {
        await ReactNativeTrackPlayer.reset();
    }
};

const setRepeatMode = (mode: MusicRepeatMode) => {
    const playList = getPlayList();
    let newPlayList;
    const prevMode = repeatModeStore.getValue();
    if (
        (prevMode === MusicRepeatMode.SHUFFLE &&
            mode !== MusicRepeatMode.SHUFFLE) ||
        (mode === MusicRepeatMode.SHUFFLE &&
            prevMode !== MusicRepeatMode.SHUFFLE)
    ) {
        if (mode === MusicRepeatMode.SHUFFLE) {
            newPlayList = shuffle(playList);
        } else {
            newPlayList = sortByTimestampAndIndex(playList, true);
        }
        setPlayList(newPlayList);
    }

    const currentMusicItem = currentMusicStore.getValue();
    currentIndex = getMusicIndex(currentMusicItem);
    repeatModeStore.setValue(mode);
    ReactNativeTrackPlayer.updateMetadataForTrack(1, getFakeNextTrack());
    PersistStatus.set('music.repeatMode', mode);
};

const clear = async () => {
    setPlayList([]);
    setCurrentMusic(null);
    await ReactNativeTrackPlayer.reset();
    PersistStatus.set('music.musicItem', undefined);
    PersistStatus.set('music.progress', 0);
};

const pause = async () => {
    await ReactNativeTrackPlayer.pause();
};

const setTrackSource = async (track: Track, autoPlay = true) => {
    if (!track.artwork?.trim()?.length) {
        track.artwork = undefined;
    }
    // Ensure the track object contains userAgent
    const trackWithUA = {
        ...track,
        userAgent: (track as any).userAgent || getAppUserAgent(), // If track doesn't have UA, use the global one
    };
    await ReactNativeTrackPlayer.setQueue([trackWithUA, getFakeNextTrack()]);
    PersistStatus.set('music.musicItem', trackWithUA as IMusic.IMusicItem);
    PersistStatus.set('music.progress', 0);
    if (autoPlay) {
        await ReactNativeTrackPlayer.play();
    }
};

const setCurrentMusic = (musicItem?: IMusic.IMusicItem | null) => {
    if (!musicItem) {
        currentIndex = -1;
        currentMusicStore.setValue(null);
        PersistStatus.set('music.musicItem', undefined);
        PersistStatus.set('music.progress', 0);
        return;
    }
    currentIndex = getMusicIndex(musicItem);
    currentMusicStore.setValue(musicItem);
};

const setQuality = (quality: IMusic.IQualityKey) => {
    qualityStore.setValue(quality);
    PersistStatus.set('music.quality', quality);
};

const play = async (
    musicItem?: IMusic.IMusicItem | null,
    forcePlay?: boolean,
) => {
    try {
        if (!musicItem) {
            musicItem = currentMusicStore.getValue();
        }
        if (!musicItem) {
            throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
        }
        const mediaExtra = MediaExtra.get(musicItem);
        const localPath =
          mediaExtra?.localPath ||
          getInternalData<string>(musicItem, InternalDataType.LOCALPATH)
        if (
            Network.isCellular() &&
            !Config.getConfig('basic.useCelluarNetworkPlay') &&
            !LocalMusicSheet.isLocalMusic(musicItem) &&
            !localPath
        ) {
            await ReactNativeTrackPlayer.reset();
            throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
        }

        if (isCurrentMusic(musicItem)) {
            const currentTrack = await ReactNativeTrackPlayer.getTrack(0);
            if (
                currentTrack?.url &&
                isSameMediaItem(musicItem, currentTrack as IMusic.IMusicItem)
            ) {
                const currentActiveIndex =
                    await ReactNativeTrackPlayer.getActiveTrackIndex();
                if (currentActiveIndex !== 0) {
                    await ReactNativeTrackPlayer.skip(0);
                }
                if (forcePlay) {
                    await ReactNativeTrackPlayer.seekTo(0);
                }
                const currentState = (
                    await ReactNativeTrackPlayer.getPlaybackState()
                ).state;
                if (currentState === State.Stopped) {
                    // Ensure UA is set if we re-set the track source
                    (currentTrack as any).userAgent = getAppUserAgent();
                    await setTrackSource(currentTrack);
                }
                if (currentState !== State.Playing) {
                    await ReactNativeTrackPlayer.play();
                }
                return;
            }
        }

        const inPlayList = isInPlayList(musicItem);
        if (!inPlayList) {
            add(musicItem);
        }

        setCurrentMusic(musicItem);
        // Prime the player with a proposed URL to avoid early errors if source fetching is slow
        await ReactNativeTrackPlayer.setQueue([{
            ...musicItem,
            url: proposedAudioUrl, // Use proposedAudioUrl
            userAgent: getAppUserAgent(), // Set UA here too
        } as Track, getFakeNextTrack()]);


        if (
            !isSameMediaItem(
                LyricManager.getLyricState()?.lyricParser?.musicItem,
                musicItem,
            )
        ) {
            DeviceEventEmitter.emit(EDeviceEvents.REFRESH_LYRIC, true);
        }

        let track: IMusic.IMusicItem;
        const plugin = PluginManager.getByName(musicItem.platform);
        const qualityOrder = getQualityOrder(
            Config.getConfig('basic.defaultPlayQuality') ?? 'standard',
            Config.getConfig('basic.playQualityOrder') ?? 'asc',
        );
        let source: IPlugin.IMediaSourceResult | null = null;
        for (let quality of qualityOrder) {
            if (isCurrentMusic(musicItem)) {
                source =
                    (await plugin?.methods?.getMediaSource(
                        musicItem,
                        quality,
                    )) ?? null;
                if (source) {
                    setQuality(quality);
                    break;
                }
            } else {
                return;
            }
        }

        if (!isCurrentMusic(musicItem)) {
            return;
        }
        if (!source) {
            if (musicItem.source) {
                for (let quality of qualityOrder) {
                    if (musicItem.source[quality]?.url) {
                        source = musicItem.source[quality]!;
                        setQuality(quality);
                        break;
                    }
                }
            }
            if (!source && !musicItem.url) {
                if (Config.getConfig('basic.tryChangeSourceWhenPlayFail')) {
                    const similarMusic = await getSimilarMusic(
                        musicItem,
                        'music',
                        () => !isCurrentMusic(musicItem),
                    );
                    if (similarMusic) {
                        const similarMusicPlugin =
                            PluginManager.getByMedia(similarMusic);
                        for (let quality of qualityOrder) {
                            if (isCurrentMusic(musicItem)) {
                                source =
                                    (await similarMusicPlugin?.methods?.getMediaSource(
                                        similarMusic,
                                        quality,
                                    )) ?? null;
                                if (source) {
                                    setQuality(quality);
                                    break;
                                }
                            } else {
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
            } else if (!source && musicItem.url) { // if !source was true but musicItem.url exists
                source = {
                    url: musicItem.url,
                };
                setQuality('standard');
            }
        }
        
        if (getUrlExt(source!.url) === '.m3u8') {
            (source as any).type = 'hls';
        }
        
        // Inject UserAgent when merging props
        const sourcePropsForTrack: Partial<Track> = { url: source!.url };
        if (source!.headers) sourcePropsForTrack.headers = source!.headers;
        sourcePropsForTrack.userAgent = getAppUserAgent();
        track = mergeProps(musicItem, sourcePropsForTrack) as IMusic.IMusicItem;


        musicHistory.addMusic(musicItem);
        trace('获取音源成功', track);
        await setTrackSource(track as Track);

        let info: Partial<IMusic.IMusicItem> | null = null;
        try {
            info = (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
            if (
                (typeof info?.url === 'string' && info.url.trim() === '') ||
                (info?.url && typeof info.url !== 'string')
            ) {
                delete info.url;
            }
        } catch {}

        if (info && isCurrentMusic(musicItem)) {
            const mergedTrack = mergeProps(track, info);
            (mergedTrack as Track).userAgent = getAppUserAgent(); // Ensure UA again before update
            currentMusicStore.setValue(mergedTrack as IMusic.IMusicItem);
            await ReactNativeTrackPlayer.updateMetadataForTrack(
                0,
                mergedTrack as TrackMetadataBase,
            );
        }
    } catch (e: any) {
        const message = e?.message;
        if (
            message === 'The player is not initialized. Call setupPlayer first.'
        ) {
            await ReactNativeTrackPlayer.setupPlayer();
            play(musicItem, forcePlay);
        } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
            if (getCurrentDialog()?.name !== 'SimpleDialog') {
                showDialog('SimpleDialog', {
                    title: '流量提醒',
                    content:
                        '当前非WIFI环境，侧边栏设置中打开【使用移动网络播放】功能后可继续播放',
                });
            }
        } else if (message === PlayFailReason.INVALID_SOURCE) {
            trace('音源为空，播放失败');
            await failToPlay();
        } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
            // Handle this case if necessary
        }
    }
};

const playWithReplacePlayList = async (
    musicItem: IMusic.IMusicItem,
    newPlayList: IMusic.IMusicItem[],
) => {
    if (newPlayList.length !== 0) {
        const now = Date.now();
        if (newPlayList.length > maxMusicQueueLength) {
            newPlayList = shrinkPlayListToSize(
                newPlayList,
                newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
            );
        }

        newPlayList.forEach((it, index) => {
            it[timeStampSymbol] = now;
            it[sortIndexSymbol] = index;
        });

        setPlayList(
            repeatModeStore.getValue() === MusicRepeatMode.SHUFFLE
                ? shuffle(newPlayList)
                : newPlayList,
        );
        await play(musicItem, true);
    }
};

const skipToNext = async () => {
    if (isPlayListEmpty()) {
        setCurrentMusic(null);
        return;
    }
    await play(getPlayListMusicAt(currentIndex + 1), true);
};

const skipToPrevious = async () => {
    if (isPlayListEmpty()) {
        setCurrentMusic(null);
        return;
    }
    await play(
        getPlayListMusicAt(currentIndex === -1 ? 0 : currentIndex - 1),
        true,
    );
};

const changeQuality = async (newQuality: IMusic.IQualityKey) => {
    if (newQuality === qualityStore.getValue()) {
        return true;
    }

    const musicItem = currentMusicStore.getValue();
    if (!musicItem) {
        return false;
    }
    try {
        const progress = await ReactNativeTrackPlayer.getProgress();
        const plugin = PluginManager.getByMedia(musicItem);
        const newSource = await plugin?.methods?.getMediaSource(
            musicItem,
            newQuality,
        );
        if (!newSource?.url) {
            throw new Error(PlayFailReason.INVALID_SOURCE);
        }
        if (isCurrentMusic(musicItem)) {
            const playingState = (
                await ReactNativeTrackPlayer.getPlaybackState()
            ).state;
            
            const trackToSet = mergeProps(musicItem, newSource) as Track;
            trackToSet.userAgent = getAppUserAgent(); // Set UA

            await setTrackSource(
                trackToSet,
                !musicIsPaused(playingState),
            );

            await ReactNativeTrackPlayer.seekTo(progress.position ?? 0);
            setQuality(newQuality);
        }
        return true;
    } catch {
        return false;
    }
};

enum PlayFailReason {
    FORBID_CELLUAR_NETWORK_PLAY = 'FORBID_CELLUAR_NETWORK_PLAY',
    PLAY_LIST_IS_EMPTY = 'PLAY_LIST_IS_EMPTY',
    INVALID_SOURCE = 'INVALID_SOURCE',
}

function useMusicState() {
    const playbackState = usePlaybackState();
    return playbackState.state;
}

function getPreviousMusic() {
    const currentMusicItem = currentMusicStore.getValue();
    if (!currentMusicItem) {
        return null;
    }
    return getPlayListMusicAt(currentIndex - 1);
}

function getNextMusic() {
    const currentMusicItem = currentMusicStore.getValue();
    if (!currentMusicItem) {
        return null;
    }
    return getPlayListMusicAt(currentIndex + 1);
}

const TrackPlayer = {
    setupTrackPlayer,
    usePlayList,
    getPlayList,
    addAll,
    add,
    addNext,
    skipToNext,
    skipToPrevious,
    play,
    playWithReplacePlayList,
    pause,
    remove,
    clear,
    useCurrentMusic: currentMusicStore.useValue,
    getCurrentMusic: currentMusicStore.getValue,
    useRepeatMode: repeatModeStore.useValue,
    getRepeatMode: repeatModeStore.getValue,
    toggleRepeatMode,
    usePlaybackState,
    getProgress: ReactNativeTrackPlayer.getProgress,
    useProgress: useProgress,
    seekTo: ReactNativeTrackPlayer.seekTo,
    changeQuality,
    useCurrentQuality: qualityStore.useValue,
    getCurrentQuality: qualityStore.getValue,
    getRate: ReactNativeTrackPlayer.getRate,
    setRate: ReactNativeTrackPlayer.setRate,
    useMusicState,
    reset: ReactNativeTrackPlayer.reset,
    getPreviousMusic,
    getNextMusic,
};

export default TrackPlayer;
export { MusicRepeatMode, State as MusicState };
