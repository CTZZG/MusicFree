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
