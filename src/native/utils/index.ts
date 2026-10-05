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

interface INativeUtils extends NativeModule {
    exitApp: () => void;
    getWindowDimensions: () => { width: number, height: number }; // Fix bug: https://github.com/facebook/react-native/issues/47080
    isIgnoringBatteryOptimizations: () => Promise<boolean>;
    requestIgnoreBatteryOptimizations: () => Promise<boolean>;
    openBatteryOptimizationSettings: () => Promise<boolean>;
    getPlaybackNativeDiagnostics?: () => Promise<IPlaybackNativeDiagnostics>;
}

const NativeUtils = NativeModules.NativeUtils;

export default NativeUtils as INativeUtils;
