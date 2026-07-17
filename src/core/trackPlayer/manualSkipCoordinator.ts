export class ManualSkipOperationGate {
    private inFlight: Promise<void> | null = null;

    run(operation: () => Promise<void>) {
        if (this.inFlight) {
            return this.inFlight;
        }

        const operationPromise = Promise.resolve().then(operation);
        const trackedPromise = operationPromise.finally(() => {
            if (this.inFlight === trackedPromise) {
                this.inFlight = null;
            }
        });
        this.inFlight = trackedPromise;
        return trackedPromise;
    }
}

interface IWaitForExpectedActiveOptions {
    timeoutMs: number;
    pollIntervalMs?: number;
    now?: () => number;
    sleep?: (durationMs: number) => Promise<void>;
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
