/**
 * 淡入淡出的纯策略层：只回答「此刻该用多大音量增益」，不碰计时器、不碰播放器。
 *
 * 这里实现的是「淡出 + 淡入」，不是真正的重叠交叉淡化——两首歌不会同时出声。
 * 真重叠需要两路解码器同时跑（mpv 侧要起第二个 core，nitro 依赖的三方库根本
 * 暴露不出第二个实例），代价远大于收益，所以上一首在末尾淡到静音、下一首从
 * 静音淡起，衔接点仍是原本的自然切歌点。
 */

export const MIN_CROSSFADE_SECONDS = 1;
export const MAX_CROSSFADE_SECONDS = 12;
export const DEFAULT_CROSSFADE_SECONDS = 5;

/** 手动切歌时把音量拉回 1 用的短坡道，只为消掉爆音，不是给人听的淡入。 */
export const RESTORE_RAMP_MS = 400;

/** 淡出坡道最短时长；进度事件粒度较粗时避免出现近乎瞬断的“淡出”。 */
export const MIN_FADE_OUT_MS = 250;

export function clampCrossfadeSeconds(seconds: number | undefined): number {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
        return DEFAULT_CROSSFADE_SECONDS;
    }
    return Math.min(
        MAX_CROSSFADE_SECONDS,
        Math.max(MIN_CROSSFADE_SECONDS, Math.round(seconds)),
    );
}

function clampRatio(ratio: number): number {
    if (!Number.isFinite(ratio)) {
        return 0;
    }
    return Math.min(1, Math.max(0, ratio));
}

/**
 * 等功率淡化曲线。即便这里两首歌不重叠，sin/cos 这一对的听感也比线性平滑：
 * 线性淡出在末尾掉得太快，会有“突然没了”的感觉。
 */
export function fadeInGain(ratio: number): number {
    return Math.sin((clampRatio(ratio) * Math.PI) / 2);
}

export function fadeOutGain(ratio: number): number {
    return Math.cos((clampRatio(ratio) * Math.PI) / 2);
}

export function linearGain(from: number, to: number, ratio: number): number {
    return from + (to - from) * clampRatio(ratio);
}

export interface FadeOutDecisionInput {
    /** 当前播放位置，秒 */
    position: number;
    /** 当前曲目总时长，秒；未知或 0 表示时长不可信 */
    duration: number;
    /** 用户设置的淡化时长，秒 */
    fadeSeconds: number;
}

/**
 * 判断此刻是否应该开始淡出，以及这条淡出坡道应该跑多久（毫秒）。
 *
 * 时长不可信（直播流、还没拿到 duration）时一律不淡出——否则会在一首根本
 * 不会结束的流上把音量拉到 0。曲目本身比两倍淡化时长还短时也不淡出，
 * 否则整首歌几乎全程都在淡入或淡出。
 */
export function resolveFadeOutDurationMs(
    input: FadeOutDecisionInput,
): number | null {
    const { position, duration, fadeSeconds } = input;
    if (
        !Number.isFinite(position) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        position < 0
    ) {
        return null;
    }
    if (duration < fadeSeconds * 2 + 1) {
        return null;
    }
    const remaining = duration - position;
    if (remaining <= 0 || remaining > fadeSeconds) {
        return null;
    }
    return Math.max(MIN_FADE_OUT_MS, Math.round(remaining * 1000));
}

/**
 * 已经开始淡出后，判断是否应该取消（用户往回拖，重新离结束很远了）。
 * 留 1 秒回差，避免正好卡在阈值上时反复开关坡道。
 */
export function shouldCancelFadeOut(input: FadeOutDecisionInput): boolean {
    const { position, duration, fadeSeconds } = input;
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
        return true;
    }
    return duration - position > fadeSeconds + 1;
}
