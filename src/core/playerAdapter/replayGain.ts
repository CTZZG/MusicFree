/**
 * 音量平衡：按歌曲文件里的 ReplayGain 标签调整音量，交给 mpv 的 replaygain 选项。
 * 没有标签的歌（多数在线音源）音量不变；mpv 默认按标签里的峰值防止加增益后削波。
 * mpv 0.41 里这个选项改了立刻生效，不用重新加载正在放的歌。
 */
export type ReplayGainMode = "off" | "track" | "album";

export const REPLAY_GAIN_MODES: ReplayGainMode[] = ["off", "track", "album"];

/** 设置里读出来的值不认识（没设过、写坏了）时按关闭处理 */
export function normalizeReplayGainMode(value: unknown): ReplayGainMode {
    return value === "track" || value === "album" ? value : "off";
}
