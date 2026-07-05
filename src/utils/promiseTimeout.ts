export class TimeoutError extends Error {
    constructor(message = "Operation timed out") {
        super(message);
        this.name = "TimeoutError";
    }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof TimeoutError;
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
        const timer = setTimeout(() => {
            reject(new TimeoutError(message));
        }, timeoutMs);

        Promise.resolve(promise).then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
