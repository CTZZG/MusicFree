/**
 * 写入调度策略（纯逻辑，不碰文件系统）。
 *
 * 目标是把「频繁的小写入」合并成「较少的整份落盘」，同时保证：
 *   - 任何一次 set 之后，最终一定会有一次包含它的落盘；
 *   - 落盘失败要能被观察到并重试，而不是静默丢失（MMKV 放在外部存储上
 *     mmap 写不回去，正是因为失败完全不可观测才藏了这么久）；
 *   - 同一 store 不并发写，避免两次写交错产生半份文件。
 */

export interface IWriteSchedulerOptions {
    /** 距首次待写变更多久后落盘。 */
    debounceMs?: number;
    /** 即使变更持续到来，最多推迟这么久也必须落盘一次。 */
    maxDelayMs?: number;
    /** 失败重试的退避序列，用尽后放弃并上报。 */
    retryDelaysMs?: number[];
}

export const DEFAULT_DEBOUNCE_MS = 120;
export const DEFAULT_MAX_DELAY_MS = 1_000;
export const DEFAULT_RETRY_DELAYS_MS = [200, 1_000, 5_000];

export interface IWriteDecisionInput {
    /** 是否有尚未落盘的变更。 */
    dirty: boolean;
    /** 是否正在写入。 */
    writing: boolean;
    /** 首次变更距今的毫秒数；无待写变更时为 null。 */
    ageMs: number | null;
    /** 距上次变更的毫秒数；无待写变更时为 null。 */
    idleMs: number | null;
    options?: IWriteSchedulerOptions;
}

export type WriteDecision =
    | { action: "idle" }
    | { action: "wait"; delayMs: number }
    | { action: "flush" };

export function resolveWriteDecision(
    input: IWriteDecisionInput,
): WriteDecision {
    if (!input.dirty) {
        return { action: "idle" };
    }
    // 正在写就不再叠加：写完之后调度器会重新评估剩余的脏状态。
    if (input.writing) {
        return { action: "idle" };
    }

    const debounceMs = input.options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const maxDelayMs = input.options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const ageMs = input.ageMs ?? 0;
    const idleMs = input.idleMs ?? 0;

    // 超过硬上限必须立刻落盘，否则持续写入的场景（例如播放进度）会让
    // debounce 永远不到期，进程被杀时丢掉全部变更。
    if (ageMs >= maxDelayMs) {
        return { action: "flush" };
    }
    if (idleMs >= debounceMs) {
        return { action: "flush" };
    }

    // 还要等多久：取「安静期到期」与「硬上限到期」中较早的那个。
    return {
        action: "wait",
        delayMs: Math.max(
            1,
            Math.min(debounceMs - idleMs, maxDelayMs - ageMs),
        ),
    };
}

export function resolveRetryDelayMs(
    attempt: number,
    options?: IWriteSchedulerOptions,
): number | null {
    const delays = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (attempt < 0 || attempt >= delays.length) {
        return null;
    }
    return delays[attempt];
}
