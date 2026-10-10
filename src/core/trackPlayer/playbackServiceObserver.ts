import TrackPlayer from "@/core/trackPlayer";
import PluginManager from "@/core/pluginManager";
import { TrackPlayerEvents } from "@/constants/trackPlayerConst";
import { normalizeMusicState } from "@/utils/trackUtils";
import { errorLog } from "@/utils/log";
import {
    createPlaybackObserverSetupGuard,
    notifyPlaybackStateChangeSafely,
    normalizePlaybackObserverProgress,
    resolvePlaybackObserverEvent,
} from "./playbackObserverPolicy";

let previousMusicItem: IMusic.IMusicItem | null = null;
let lastProgressTime = 0;
const PROGRESS_THROTTLE_MS = 1000; // 进度回调节流，每秒一次
const shouldSetupPlaybackObserver = createPlaybackObserverSetupGuard();

function notifyPluginPlaybackStateChange(
    plugin: ReturnType<typeof PluginManager.getByMedia> | null | undefined,
    payload: IPlugin.IPlaybackStateChangeParams,
) {
    notifyPlaybackStateChangeSafely(
        plugin?.instance.onPlaybackStateChange,
        payload,
        error => {
            errorLog("插件播放状态回调失败", error);
        },
    );
}

function setupPlaybackObserver() {
    if (!shouldSetupPlaybackObserver()) {
        return;
    }

    // 监听歌曲切换
    TrackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, musicItem => {
        if (previousMusicItem && previousMusicItem.platform) {
            const plugin = PluginManager.getByMedia(previousMusicItem);
            notifyPluginPlaybackStateChange(plugin, {
                musicItem: previousMusicItem,
                event: "track-change",
            });
        }
        previousMusicItem = musicItem;
    });

    // 监听播放/暂停/停止状态
    TrackPlayer.playerAdapter.addEventListener(
        "playbackStateChanged",
        state => {
            const musicItem = TrackPlayer.currentMusic;
            if (!musicItem || !musicItem.platform) return;

            const plugin = PluginManager.getByMedia(musicItem);
            if (!plugin?.instance.onPlaybackStateChange) return;

            const normalizedState = normalizeMusicState(state);
            const eventType = resolvePlaybackObserverEvent(normalizedState);

            if (eventType) {
                notifyPluginPlaybackStateChange(plugin, {
                    musicItem,
                    event: eventType,
                });
            }
        },
    );

    // 监听进度更新
    TrackPlayer.playerAdapter.addEventListener("progress", progress => {
        const now = Date.now();
        if (now - lastProgressTime < PROGRESS_THROTTLE_MS) {
            return;
        }
        lastProgressTime = now;

        const musicItem = TrackPlayer.currentMusic;
        if (!musicItem || !musicItem.platform) return;

        const plugin = PluginManager.getByMedia(musicItem);
        if (!plugin?.instance.onPlaybackStateChange) return;

        notifyPluginPlaybackStateChange(plugin, {
            musicItem,
            event: "progress",
            data: normalizePlaybackObserverProgress(progress),
        });
    });
    // 监听 mpv 锁屏/耳机键的「上一首/下一首」，走完整 App 逻辑（稍后播放队列、自动跳过不喜欢）。
    // 仅 mpv 后端会发这些事件；Nitro 由原生会话处理，这里订阅是无副作用的空操作。
    // 把原生入队时间透传下去：操作在 TrackPlayer 的串行队列里等太久就作废，
    // 避免一次挂死的取源把用户点的多次上/下一首攒住、之后一次性补跑。
    TrackPlayer.playerAdapter.addEventListener("remoteNext", event => {
        TrackPlayer.skipToNext(event?.enqueuedAt).catch(error => {
            errorLog("远程下一首处理失败", error?.message ?? error);
        });
    });
    TrackPlayer.playerAdapter.addEventListener("remotePrevious", event => {
        TrackPlayer.skipToPrevious(event?.enqueuedAt).catch(error => {
            errorLog("远程上一首处理失败", error?.message ?? error);
        });
    });
    // 通知栏、锁屏、耳机、蓝牙的播放/暂停，拔耳机，音频焦点：以前由适配器直接
    // 停、直接放，TrackPlayer 不知道，切歌回滚、装载完成、自动播放补偿会把外部
    // 暂停盖掉。现在统一交给 TrackPlayer，分成用户主动暂停和系统临时打断
    TrackPlayer.playerAdapter.addEventListener("remotePlay", () => {
        TrackPlayer.play().catch(error => {
            errorLog("远程播放处理失败", error?.message ?? error);
        });
    });
    TrackPlayer.playerAdapter.addEventListener("remotePause", event => {
        TrackPlayer.pauseByExternalRequest(event?.reason ?? "remote").catch(
            error => {
                errorLog("远程暂停处理失败", error?.message ?? error);
            },
        );
    });
    TrackPlayer.playerAdapter.addEventListener("remoteInterruption", event => {
        if (event?.phase === "ended") {
            TrackPlayer.handleSystemInterruptionEnded().catch(error => {
                errorLog("系统打断结束处理失败", error?.message ?? error);
            });
        } else {
            TrackPlayer.handleSystemInterruptionBegan();
        }
    });
    TrackPlayer.playerAdapter.addEventListener("remotePlayFromId", () => {
        TrackPlayer.notePlayRequestedFromOutside();
    });
}

export default { setupPlaybackObserver };
