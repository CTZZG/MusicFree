import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { BackHandler } from "react-native";

const EXIT_PREPARE_GRACE_MS = 500;

let isExiting = false;

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function preparePlayerForExitBestEffort() {
    try {
        return Promise.resolve(TrackPlayer.prepareForAppExit()).catch(
            () => undefined,
        );
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

    const exitAfterPrepareOrTimeout = Promise.race([
        preparePlayerForExitBestEffort(),
        wait(EXIT_PREPARE_GRACE_MS),
    ]);

    exitAfterPrepareOrTimeout.finally(exitNativeProcess);
    setTimeout(exitNativeProcess, EXIT_PREPARE_GRACE_MS + 500);
}
