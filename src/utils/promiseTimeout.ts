import BackgroundTimer from "react-native-background-timer";

export class TimeoutError extends Error {
    constructor(message = "Operation timed out") {
        super(message);
        this.name = "TimeoutError";
    }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof TimeoutError;
}

function scheduleTimeout(handler: () => void, timeoutMs: number): unknown {
    if (typeof BackgroundTimer?.setTimeout === "function") {
        return BackgroundTimer.setTimeout(handler, timeoutMs);
    }
    return setTimeout(handler, timeoutMs);
}

function clearScheduledTimeout(handle: unknown) {
    if (typeof BackgroundTimer?.clearTimeout === "function") {
        BackgroundTimer.clearTimeout(handle as number);
    } else {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
}

export function withTimeout<T>(
    promise: PromiseLike<T>,
    timeoutMs: number,
    message?: string,
): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.resolve(promise);
    }

    return new Promise<T>((resolve, reject) => {
        const timer = scheduleTimeout(() => {
            reject(new TimeoutError(message));
        }, timeoutMs);

        Promise.resolve(promise).then(
            value => {
                clearScheduledTimeout(timer);
                resolve(value);
            },
            error => {
                clearScheduledTimeout(timer);
                reject(error);
            },
        );
    });
}
