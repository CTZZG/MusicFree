import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { BackHandler } from "react-native";

const RESET_GRACE_MS = 500;

let isExiting = false;

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetPlayerBestEffort() {
    try {
        return Promise.resolve(TrackPlayer.reset()).catch(() => undefined);
    } catch {
        return Promise.resolve();
    }
}

function exitNativeProcess() {
    try {
        NativeUtils?.exitApp?.();
    } catch {
        BackHandler.exitApp();
    }
}

export default function forceExitApp() {
    if (isExiting) {
        return;
    }
    isExiting = true;

    const exitAfterResetOrTimeout = Promise.race([
        resetPlayerBestEffort(),
        wait(RESET_GRACE_MS),
    ]);

    exitAfterResetOrTimeout.finally(exitNativeProcess);
    setTimeout(exitNativeProcess, RESET_GRACE_MS + 500);
}
