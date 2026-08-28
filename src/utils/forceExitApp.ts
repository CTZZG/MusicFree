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

/**
 * 退出前把待写的键值变更落盘。
 *
 * 写入是合并延迟的（见 keyValueStore/writeScheduler），最后几百毫秒内的
 * 变更可能还在内存里。硬上限保证了不会丢太多，但退出这条路径值得显式
 * flush 一次——用户点了「退出」之后设置没保存是很难解释的。
 */
function flushStoresBestEffort() {
    try {
        return require("@/utils/keyValueStore/bootstrapStores")
            .shutdownKeyValueStores()
            .catch(() => undefined);
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
        Promise.all([
            preparePlayerForExitBestEffort(),
            flushStoresBestEffort(),
        ]),
        wait(EXIT_PREPARE_GRACE_MS),
    ]);

    exitAfterPrepareOrTimeout.finally(exitNativeProcess);
    setTimeout(exitNativeProcess, EXIT_PREPARE_GRACE_MS + 500);
}
