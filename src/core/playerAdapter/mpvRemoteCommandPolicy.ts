import type { MpvRemoteCommand } from "./nativeMpvPlayer";

/**
 * 原生把命令投递给 JS 正常在几十毫秒内完成。超过这个阈值只可能是 JS 线程被
 * 系统冻结/限流后事件堆积在桥上，回到前台才一次性重放。
 */
export const mpvRemoteCommandStaleThresholdMs = 5000;

/**
 * 只丢弃会「叠加」的命令：连点 5 次下一首在解冻后会连跳 5 首。
 * play/pause/stop/duck 是幂等的，迟到执行仍然符合用户意图，保持透传。
 */
const compoundingCommands = new Set<MpvRemoteCommand>([
    "next",
    "previous",
    "seek",
    "playFromId",
]);

export interface IMpvRemoteCommandStaleInput {
    command: MpvRemoteCommand;
    enqueuedAt?: number | null;
    now: number;
    thresholdMs?: number;
}

export function isStaleMpvRemoteCommand(
    input: IMpvRemoteCommandStaleInput,
): boolean {
    const { command, enqueuedAt, now } = input;
    if (!compoundingCommands.has(command)) {
        return false;
    }
    if (
        typeof enqueuedAt !== "number" ||
        !Number.isFinite(enqueuedAt) ||
        enqueuedAt <= 0
    ) {
        // 旧原生版本不带时间戳，保持原行为。
        return false;
    }
    const thresholdMs = input.thresholdMs ?? mpvRemoteCommandStaleThresholdMs;
    const ageMs = now - enqueuedAt;
    // 设备时钟回拨会让 age 变成负数，这种情况不当作过期。
    return ageMs > thresholdMs;
}
