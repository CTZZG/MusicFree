import { NativeEventEmitter, NativeModules, Platform } from "react-native";

/**
 * mpv 播放引擎的原生桥接层（仅 Android）。
 *
 * 设计要点：mpv 只当「单曲播放引擎」——加载一个 URL、播放/暂停/seek、上报进度与结束。
 * 队列、上一首/下一首、repeat 等全部由 JS 侧的 mpvPlayerAdapter 管理，从根上
 * 避开老 dev-mpv1 中「原生维护队列、与 RN 状态对账」导致的状态同步问题。
 *
 * 本文件定义的方法/事件即为原生模块（MpvPlayerModule.kt）必须实现的契约。
 */

export type MpvPlayerState =
    | "idle"
    | "buffering"
    | "playing"
    | "paused"
    | "ended"
    | "error";

export type MpvRemoteCommand =
    | "play"
    | "pause"
    | "next"
    | "previous"
    | "stop"
    | "seek";

/** 初始化参数 */
export interface MpvInitializeOptions {
    /** 全局 User-Agent，未在单曲覆盖时使用 */
    userAgent?: string;
    /** 进度回调间隔（毫秒），默认 1000 */
    progressIntervalMs?: number;
    /** 透传给 mpv 的额外属性（如 audio-buffer、cache 等） */
    mpvOptions?: Record<string, string>;
}

/** 加载并播放一首音乐时传给原生的载荷（含 MediaSession 展示用元数据） */
export interface MpvLoadPayload {
    url: string;
    headers?: Record<string, string>;
    userAgent?: string;
    /** 以下为锁屏/通知栏 MediaSession 展示用 */
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string | null;
    /** 已知时长（秒），用于 seek 边界与通知进度，未知传 0 */
    duration?: number;
}

interface MpvPlayerNativeModule {
    initialize(options: MpvInitializeOptions): Promise<void>;
    destroy(): Promise<void>;
    loadAndPlay(payload: MpvLoadPayload): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    seekTo(seconds: number): Promise<void>;
    /** 0-1 */
    setVolume(volume: number): Promise<void>;
    setRate(rate: number): Promise<void>;
    getIsPlaying(): Promise<boolean>;
    getPosition(): Promise<number>;
    getDuration(): Promise<number>;
    /** 仅更新 MediaSession 元数据（不重载音轨），用于 JS 切歌后刷新通知 */
    updateMetadata(payload: Omit<MpvLoadPayload, "url" | "headers">): Promise<void>;
}

export const ON_MPV_STATE_CHANGED = "onMpvStateChanged";
export const ON_MPV_PROGRESS = "onMpvProgress";
export const ON_MPV_ENDED = "onMpvEnded";
export const ON_MPV_ERROR = "onMpvError";
export const ON_MPV_REMOTE_COMMAND = "onMpvRemoteCommand";

export interface MpvStateChangedEvent {
    state: MpvPlayerState;
}
export interface MpvProgressEvent {
    position: number;
    duration: number;
}
export interface MpvEndedEvent {
    /** 自然播放结束 vs 出错中断 */
    reason?: "end" | "error";
}
export interface MpvErrorEvent {
    message: string;
    code?: string | number;
}
export interface MpvRemoteCommandEvent {
    command: MpvRemoteCommand;
    /** seek 命令携带目标秒数 */
    position?: number;
}

const nativeModule = NativeModules.MpvPlayer as MpvPlayerNativeModule | undefined;

/** mpv 原生模块是否可用（仅在已构建原生模块的 Android 上为 true） */
export function isMpvAvailable(): boolean {
    return Platform.OS === "android" && !!nativeModule;
}

function assertAvailable(): MpvPlayerNativeModule {
    if (!nativeModule) {
        throw new Error(
            "mpv 原生模块不可用：请确认已在 Android 工程中构建并注册 MpvPlayer（iOS 暂不支持）。",
        );
    }
    return nativeModule;
}

// 仅在模块存在时创建 emitter，避免 NativeEventEmitter 对空模块告警
const emitter = nativeModule
    ? new NativeEventEmitter(nativeModule as any)
    : null;

function addListener<T>(
    event: string,
    callback: (payload: T) => void,
): { remove(): void } {
    if (!emitter) {
        return { remove: () => undefined };
    }
    const sub = emitter.addListener(event, callback);
    return { remove: () => sub.remove() };
}

const NativeMpvPlayer = {
    isAvailable: isMpvAvailable,

    initialize: (options: MpvInitializeOptions = {}) =>
        assertAvailable().initialize(options),
    destroy: () => assertAvailable().destroy(),
    loadAndPlay: (payload: MpvLoadPayload) =>
        assertAvailable().loadAndPlay(payload),
    pause: () => assertAvailable().pause(),
    resume: () => assertAvailable().resume(),
    stop: () => assertAvailable().stop(),
    seekTo: (seconds: number) => assertAvailable().seekTo(seconds),
    setVolume: (volume: number) => assertAvailable().setVolume(volume),
    setRate: (rate: number) => assertAvailable().setRate(rate),
    getIsPlaying: () => assertAvailable().getIsPlaying(),
    getPosition: () => assertAvailable().getPosition(),
    getDuration: () => assertAvailable().getDuration(),
    updateMetadata: (payload: Omit<MpvLoadPayload, "url" | "headers">) =>
        assertAvailable().updateMetadata(payload),

    // 事件订阅
    addStateChangedListener: (cb: (e: MpvStateChangedEvent) => void) =>
        addListener<MpvStateChangedEvent>(ON_MPV_STATE_CHANGED, cb),
    addProgressListener: (cb: (e: MpvProgressEvent) => void) =>
        addListener<MpvProgressEvent>(ON_MPV_PROGRESS, cb),
    addEndedListener: (cb: (e: MpvEndedEvent) => void) =>
        addListener<MpvEndedEvent>(ON_MPV_ENDED, cb),
    addErrorListener: (cb: (e: MpvErrorEvent) => void) =>
        addListener<MpvErrorEvent>(ON_MPV_ERROR, cb),
    addRemoteCommandListener: (cb: (e: MpvRemoteCommandEvent) => void) =>
        addListener<MpvRemoteCommandEvent>(ON_MPV_REMOTE_COMMAND, cb),
};

export default NativeMpvPlayer;
