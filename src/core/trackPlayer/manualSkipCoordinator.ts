export interface IManualSkipOperationToken {
    readonly id: number;
    readonly generation: number;
}

export class ManualSkipOperationGate {
    private tail: Promise<void> = Promise.resolve();
    private pendingOperations = 0;
    private generation = 0;
    private sequence = 0;

    run(
        operation: (token: IManualSkipOperationToken) => Promise<void>,
    ) {
        const generation = this.generation;
        const token = {
            id: ++this.sequence,
            generation,
        };
        this.pendingOperations += 1;
        const operationPromise = this.tail.catch(() => undefined).then(() => {
            if (generation !== this.generation) {
                return;
            }
            return operation(token);
        });
        this.tail = operationPromise.then(
            () => {
                this.pendingOperations -= 1;
            },
            () => {
                this.pendingOperations -= 1;
            },
        );
        return operationPromise;
    }

    get pendingCount() {
        return this.pendingOperations;
    }

    get isPending() {
        return this.pendingOperations > 0;
    }

    isActive(token?: IManualSkipOperationToken | null) {
        return !!token && token.generation === this.generation;
    }

    cancelPending() {
        this.generation += 1;
    }
}

export interface IMpvTrackTransitionToken {
    readonly id: number;
    readonly expectedKey: string;
}

export class MpvTrackTransitionGate {
    private sequence = 0;
    private activeToken: IMpvTrackTransitionToken | null = null;

    begin(expectedKey: string): IMpvTrackTransitionToken {
        const token = {
            id: ++this.sequence,
            expectedKey,
        };
        this.activeToken = token;
        return token;
    }

    get active() {
        return this.activeToken;
    }

    isActive(token?: IMpvTrackTransitionToken | null) {
        return !!token && this.activeToken?.id === token.id;
    }

    acceptsActiveKey(activeKey?: string | null) {
        return !this.activeToken || activeKey === this.activeToken.expectedKey;
    }

    clear(token: IMpvTrackTransitionToken) {
        if (!this.isActive(token)) {
            return false;
        }
        this.activeToken = null;
        return true;
    }
}

/**
 * 手动切歌事务期间，后端事件是否应当被忽略。
 *
 * 背景：用户点「下一首」之后，mpv 仍会为**上一首**发出 trackChanged /
 * playbackError / active-track 同步事件。这些迟到事件如果被当成真实状态处理，
 * 就会把刚切过去的曲目又拽回旧的那首。原先这个判定在 TrackPlayer 里重复了
 * 四遍（每类事件一份），每份都夹着自己的 trace 调用，导致规则本身看不清、
 * 也无法单测。
 *
 * 规则只有一条：事务活跃时，只接受身份与预期一致的事件。
 */
export function shouldIgnoreDuringTransition(input: {
    /** 事务是否活跃。 */
    transitionActive: boolean;
    /** 事件所指向的曲目 key；无法解析时为 null。 */
    eventKey?: string | null;
    /** 事务期待的曲目 key。 */
    expectedKey?: string | null;
}): boolean {
    if (!input.transitionActive) {
        return false;
    }
    // 没有预期身份时不过滤：那说明事务状态本身不完整，宁可放过也不要卡死。
    if (!input.expectedKey) {
        return false;
    }
    return input.eventKey !== input.expectedKey;
}

interface IWaitForExpectedActiveOptions {
    timeoutMs: number;
    pollIntervalMs?: number;
    now?: () => number;
    sleep?: (durationMs: number) => Promise<void>;
    isCancelled?: () => boolean;
}

export async function waitForExpectedActive<T>(
    readActive: () => Promise<T | null>,
    isExpected: (active: T) => boolean,
    options: IWaitForExpectedActiveOptions,
) {
    const now = options.now ?? Date.now;
    const sleep =
        options.sleep ??
        (durationMs =>
            new Promise<void>(resolve => setTimeout(resolve, durationMs)));
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 32);
    const deadline = now() + Math.max(0, options.timeoutMs);

    do {
        if (options.isCancelled?.()) {
            return null;
        }
        const active = await readActive();
        if (active && isExpected(active)) {
            return active;
        }
        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
            break;
        }
        await sleep(Math.min(pollIntervalMs, remainingMs));
    } while (true);

    return null;
}
