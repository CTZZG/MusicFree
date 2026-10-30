import { NativeModule, NativeModules } from "react-native";

export interface IPlaybackNativeServiceDiagnostic {
    className: string;
    shutdownAction: string;
    declared: boolean;
    running: boolean;
}

export interface IPlaybackNativeMediaSessionDiagnostic {
    access: "granted" | "denied" | "error";
    activeSessionCount?: number;
    hasOwnActiveSession?: boolean;
    playbackStates?: string[];
    reason?: string;
}

/** 播放服务最近一次加载封面（通知、锁屏、Live Update 用）的结果 */
export interface IPlaybackNativeArtworkDiagnostic {
    /** none：应用没给封面地址 */
    state: "none" | "loading" | "loaded" | "retrying" | "failed";
    host?: string;
    attempt?: number;
    reason?: string;
    updatedAt?: number;
}

export interface IPlaybackNativeDiagnostics {
    packageName?: string;
    processId?: number;
    checkedAt?: number;
    notificationPermission?: boolean;
    batteryOptimizationIgnored?: boolean;
    appImportance?: number;
    appImportanceLabel?: string;
    playbackServices?: IPlaybackNativeServiceDiagnostic[];
    mediaSession?: IPlaybackNativeMediaSessionDiagnostic;
    artwork?: IPlaybackNativeArtworkDiagnostic;
    error?: string;
}

/** 一次未捕获的 Java/Kotlin 崩溃（本机记录） */
export interface INativeJavaCrash {
    at: number;
    thread: string;
    appVersion: string;
    exception: string;
    message: string;
    stack: string;
}

/** 原生崩溃的要点（从系统的 tombstone 里取） */
export interface INativeCrashSummary {
    signal?: string;
    signalCode?: string;
    faultAddress?: string;
    abortMessage?: string;
    thread?: string;
    causes: string[];
    frames: string[];
}

/** 系统记下的一次进程退出（ApplicationExitInfo） */
export interface INativeProcessExit {
    at: number;
    reason: string;
    abnormal: boolean;
    status: number;
    /** 退出时的进程重要性：100 前台，125 前台服务，400 缓存 */
    importance: number;
    pssKb: number;
    rssKb: number;
    description?: string;
    /** 这次崩溃的调用栈在 javaCrashes 里 */
    javaCrashRecorded?: boolean;
    anrMainThread?: string;
    nativeCrash?: INativeCrashSummary;
}

export interface INativeCrashDiagnostics {
    /** 用户清除记录的时刻，0 表示没清过 */
    clearedBefore: number;
    javaCrashes: INativeJavaCrash[];
    exits: INativeProcessExit[];
}

interface INativeUtils extends NativeModule {
    saveShareImage: (pngBase64: string) => Promise<string>;
    exitApp: () => void;
    getWindowDimensions: () => { width: number, height: number }; // Fix bug: https://github.com/facebook/react-native/issues/47080
    isIgnoringBatteryOptimizations: () => Promise<boolean>;
    requestIgnoreBatteryOptimizations: () => Promise<boolean>;
    openBatteryOptimizationSettings: () => Promise<boolean>;
    getPlaybackNativeDiagnostics?: () => Promise<IPlaybackNativeDiagnostics>;
    getCrashDiagnostics?: () => Promise<INativeCrashDiagnostics>;
    clearCrashDiagnostics?: () => Promise<boolean>;
}

const NativeUtils = NativeModules.NativeUtils;

export default NativeUtils as INativeUtils;
