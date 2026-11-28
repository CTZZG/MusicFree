export class TimeoutError extends Error {
    constructor(message = "Operation timed out") {
        super(message);
        this.name = "TimeoutError";
    }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof TimeoutError;
}

interface BackgroundTimerLike {
    setTimeout?: (handler: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    constructor?: { name?: string };
}

function resolveBackgroundTimer(): BackgroundTimerLike | null {
    try {
        const reactNative = require("react-native") as {
            NativeModules?: { RNBackgroundTimer?: unknown };
        };
        const mod = require("react-native-background-timer") as {
            default?: BackgroundTimerLike;
        } & BackgroundTimerLike;
        const timer = mod?.default ?? mod;
        if (
            typeof timer?.setTimeout !== "function" ||
            typeof timer?.clearTimeout !== "function"
        ) {
            return null;
        }
        const isMockFn =
            typeof jest !== "undefined" &&
            typeof jest.isMockFunction === "function" &&
            jest.isMockFunction(timer.setTimeout);
        if (
            !isMockFn &&
            timer.constructor?.name === "BackgroundTimer" &&
            !reactNative?.NativeModules?.RNBackgroundTimer
        ) {
            return null;
        }
        return timer;
    } catch {
        return null;
    }
}

function scheduleTimeout(handler: () => void, timeoutMs: number): {
    handle: unknown;
    timer: BackgroundTimerLike | null;
} {
    const timer = resolveBackgroundTimer();
    if (timer?.setTimeout) {
        return {
            handle: timer.setTimeout(handler, timeoutMs),
            timer,
        };
    }
    return {
        handle: setTimeout(handler, timeoutMs),
        timer: null,
    };
}

function clearScheduledTimeout(entry: {
    handle: unknown;
    timer: BackgroundTimerLike | null;
}) {
    if (entry.timer?.clearTimeout) {
        entry.timer.clearTimeout(entry.handle);
    } else {
        clearTimeout(entry.handle as ReturnType<typeof setTimeout>);
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
        const scheduled = scheduleTimeout(() => {
            reject(new TimeoutError(message));
        }, timeoutMs);

        Promise.resolve(promise).then(
            value => {
                clearScheduledTimeout(scheduled);
                resolve(value);
            },
            error => {
                clearScheduledTimeout(scheduled);
                reject(error);
            },
        );
    });
}
