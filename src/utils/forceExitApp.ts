import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { BackHandler } from "react-native";

const EXIT_PREPARE_GRACE_MS = 500;
/** 退出预算里留给播放器收集最终进度的部分，剩下的留给落盘。 */
const PLAYER_PREPARE_BUDGET_MS = 300;

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

    // 先让播放器把最终进度写进 PersistStatus，再落盘。以前两者并行：播放器要等
    // 原生返回进度才写断点，落盘可能已经先完成，新断点留在内存里，下次打开
    // 回到旧的位置。两步都在同一个预算里，播放器卡住也不会拖住退出。
    const exitAfterPrepareOrTimeout = Promise.race([
        (async () => {
            await Promise.race([
                preparePlayerForExitBestEffort(),
                wait(PLAYER_PREPARE_BUDGET_MS),
            ]);
            await flushStoresBestEffort();
        })(),
        wait(EXIT_PREPARE_GRACE_MS),
    ]);

    exitAfterPrepareOrTimeout.finally(exitNativeProcess);
    setTimeout(exitNativeProcess, EXIT_PREPARE_GRACE_MS + 500);
}
