import TrackPlayer from "@/core/trackPlayer";
import PluginManager from "@/core/pluginManager";
import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import RNTrackPlayer, { Event, State } from "react-native-track-player";

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
    RNTrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
        const musicItem = TrackPlayer.currentMusic;
        if (!musicItem || !musicItem.platform) return;

        const plugin = PluginManager.getByMedia(musicItem);
        if (!plugin?.instance.onPlaybackStateChange) return;

        let eventType: "play" | "pause" | "stop" | null = null;
        if (state === State.Playing) eventType = "play";
        else if (state === State.Paused) eventType = "pause";
        else if (state === State.Stopped || state === State.None) eventType = "stop";

        if (eventType) {
            plugin.instance.onPlaybackStateChange({
                musicItem,
                event: eventType,
            });
        }
    });

    // 监听进度更新
    RNTrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (progress) => {
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
}

export default { setupPlaybackObserver };