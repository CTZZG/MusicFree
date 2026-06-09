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
    error?: string;
}

interface INativeUtils extends NativeModule {
    exitApp: () => void;
    checkStoragePermission: () => Promise<boolean>;
    requestStoragePermission: () => void;
    getWindowDimensions: () => { width: number, height: number }; // Fix bug: https://github.com/facebook/react-native/issues/47080
    isIgnoringBatteryOptimizations: () => Promise<boolean>;
    requestIgnoreBatteryOptimizations: () => Promise<boolean>;
    openBatteryOptimizationSettings: () => Promise<boolean>;
    getPlaybackNativeDiagnostics?: () => Promise<IPlaybackNativeDiagnostics>;
}

const NativeUtils = NativeModules.NativeUtils;

export default NativeUtils as INativeUtils;
