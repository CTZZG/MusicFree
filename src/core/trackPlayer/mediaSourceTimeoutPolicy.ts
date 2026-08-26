/**
 * 插件取源没有超时是后台停播的一条真实成因：`play()` 直接 await 插件的
 * `getMediaSource()`，插件 Promise 若永不 settle，这次切歌就永远挂着。它又占着
 * `ManualSkipOperationGate` 的串行队列，于是用户在通知栏点的每一次上/下一首都
 * 排在后面静静等待——表现为「按钮没反应」；等它终于 settle，队列一次性排空，
 * 又表现为「一下子连跳好几首」。
 */

export const mediaSourceTimeoutMs = 15000;

/** 手动切歌意图在队列里等待多久之后就不该再执行 */
export const manualSkipIntentTtlMs = 8000;

export class MediaSourceTimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number) {
        super(`media source resolution timed out after ${timeoutMs}ms`);
        this.name = "MediaSourceTimeoutError";
        this.timeoutMs = timeoutMs;
    }
}

export interface IWithMediaSourceTimeoutOptions {
    timeoutMs?: number;
    /** 注入用；默认 setTimeout */
    setTimer?: (handler: () => void, delayMs: number) => any;
    clearTimer?: (handle: any) => void;
}

/**
 * 给取源加硬超时。超时后调用方会走失败分支继续推进；晚到的结果不再被等待，
 * 调用方自身的 request-generation 守卫（isPlayRequestActive）负责阻止它回写状态。
 */
export function withMediaSourceTimeout<T>(
    task: Promise<T>,
    options: IWithMediaSourceTimeoutOptions = {},
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? mediaSourceTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return task;
    }
    const setTimer = options.setTimer ?? setTimeout;
    const clearTimer = options.clearTimer ?? clearTimeout;

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const handle = setTimer(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new MediaSourceTimeoutError(timeoutMs));
        }, timeoutMs);

        task.then(
            value => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimer(handle);
                resolve(value);
            },
            error => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimer(handle);
                reject(error);
            },
        );
    });
}

export interface IStaleManualSkipInput {
    /** 原生把命令投递给 JS 时的时间戳 */
    enqueuedAt?: number | null;
    now: number;
    ttlMs?: number;
}

/**
 * 判断一个排队中的手动切歌意图是否已经过期。
 *
 * 注意与远程命令送达时的过期判断的区别：那一处拦的是「JS 被冻结、事件堆在桥上」；
 * 这一处拦的是「事件及时送到了，但操作在 JS 的串行队列里等了太久」。真机上后者
 * 才是「点了没反应、回前台连跳好几首」的成因。
 *
 * 语义取舍：卡顿之后用户想要的是「到下一首」，不是把积压的 5 次点击补跑完，
 * 所以过期的意图直接作废，只让最新的一次生效。
 */
export function isStaleManualSkipIntent(
    input: IStaleManualSkipInput,
): boolean {
    const { enqueuedAt, now } = input;
    if (
        typeof enqueuedAt !== "number" ||
        !Number.isFinite(enqueuedAt) ||
        enqueuedAt <= 0
    ) {
        // 没有时间戳（例如 App 内按钮触发）就一律执行，保持原行为。
        return false;
    }
    const ttlMs = input.ttlMs ?? manualSkipIntentTtlMs;
    const waitedMs = now - enqueuedAt;
    // 设备时钟回拨会让 waited 变成负数，这种情况不当作过期。
    return waitedMs > ttlMs;
}
