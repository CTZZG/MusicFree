export enum TrackPlayerEvents {
    // 一首歌曲播放结束
    PlayEnd = "play-end",
    // 更换正在播放的歌曲
    CurrentMusicChanged = "current-music-changed",
    // 进度更新
    ProgressChanged = "progress-changed",
    // 非 WIFI 环境且未允许移动网络播放（UI 层应提示用户）
    CellularPlayForbidden = "cellular-play-forbidden",
    // 已自动跳过一首被标记为不喜欢的歌曲（UI 层应提示用户）
    AutoSkipDislikedMusic = "auto-skip-disliked-music",
    // 队列中没有可播放的歌曲（UI 层应提示用户）
    NoPlayableMusic = "no-playable-music",
}

export enum MusicRepeatMode {
    /** 随机播放 */
    SHUFFLE = "SHUFFLE",
    /** 列表循环 */
    QUEUE = "QUEUE",
    /** 单曲循环 */
    SINGLE = "SINGLE",
}


export const MusicRepeatModeInfo = {
    [MusicRepeatMode.QUEUE]: {
        icon: "repeat-song-1",
        text: "列表循环",
    },
    [MusicRepeatMode.SINGLE]: {
        icon: "repeat-song",
        text: "单曲循环",
    },
    [MusicRepeatMode.SHUFFLE]: {
        icon: "shuffle",
        text: "随机播放",
    },
} as const;