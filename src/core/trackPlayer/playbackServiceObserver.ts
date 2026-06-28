import TrackPlayer from "@/core/trackPlayer";
import PluginManager from "@/core/pluginManager";
import { TrackPlayerEvents } from "@/constants/trackPlayerConst";
import { normalizeMusicState } from "@/utils/trackUtils";

let previousMusicItem: IMusic.IMusicItem | null = null;
let lastProgressTime = 0;
const PROGRESS_THROTTLE_MS = 1000; // 进度回调节流，每秒一次

function setupPlaybackObserver() {
    // 监听歌曲切换
    TrackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, (musicItem) => {
        if (previousMusicItem && previousMusicItem.platform) {
            const plugin = PluginManager.getByMedia(previousMusicItem);
            plugin?.instance.onPlaybackStateChange?.({
                musicItem: previousMusicItem,
                event: "track-change",
            });
        }
        previousMusicItem = musicItem;
    });

    // 监听播放/暂停/停止状态
    TrackPlayer.playerAdapter.addEventListener("playbackStateChanged", state => {
        const musicItem = TrackPlayer.currentMusic;
        if (!musicItem || !musicItem.platform) return;

        const plugin = PluginManager.getByMedia(musicItem);
        if (!plugin?.instance.onPlaybackStateChange) return;

        let eventType: "play" | "pause" | "stop" | null = null;
        const normalizedState = normalizeMusicState(state);
        if (normalizedState === "playing") eventType = "play";
        else if (normalizedState === "paused") eventType = "pause";
        else if (normalizedState === "stopped" || normalizedState === "idle") eventType = "stop";

        if (eventType) {
            plugin.instance.onPlaybackStateChange({
                musicItem,
                event: eventType,
            });
        }
    });

    // 监听进度更新
    TrackPlayer.playerAdapter.addEventListener("progress", (progress) => {
        const now = Date.now();
        if (now - lastProgressTime < PROGRESS_THROTTLE_MS) {
            return;
        }
        lastProgressTime = now;

        const musicItem = TrackPlayer.currentMusic;
        if (!musicItem || !musicItem.platform) return;

        const plugin = PluginManager.getByMedia(musicItem);
        if (!plugin?.instance.onPlaybackStateChange) return;

        plugin.instance.onPlaybackStateChange({
            musicItem,
            event: "progress",
            data: {
                currentTime: progress.position,
                duration: progress.duration,
            },
        });
    });
    // 监听 mpv 锁屏/耳机键的「上一首/下一首」，走完整 App 逻辑（稍后播放队列、自动跳过不喜欢）。
    // 仅 mpv 后端会发这些事件；Nitro 由原生会话处理，这里订阅是无副作用的空操作。
    TrackPlayer.playerAdapter.addEventListener("remoteNext", () => {
        TrackPlayer.skipToNext();
    });
    TrackPlayer.playerAdapter.addEventListener("remotePrevious", () => {
        TrackPlayer.skipToPrevious();
    });
}

export default { setupPlaybackObserver };
