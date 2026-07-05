export type PlaybackObserverEvent = "play" | "pause" | "stop";

export interface PlaybackObserverProgressInput {
    position?: unknown;
    duration?: unknown;
}

export interface PlaybackObserverProgressData {
    currentTime: number;
    duration: number;
}

export function resolvePlaybackObserverEvent(
    normalizedState?: string | null,
): PlaybackObserverEvent | null {
    if (normalizedState === "playing") {
        return "play";
    }
    if (normalizedState === "paused") {
        return "pause";
    }
    if (normalizedState === "stopped" || normalizedState === "idle") {
        return "stop";
    }
    return null;
}

export function notifyPlaybackStateChangeSafely<TPayload>(
    handler: ((payload: TPayload) => unknown) | null | undefined,
    payload: TPayload,
    onError?: (error: unknown) => void,
) {
    if (!handler) {
        return false;
    }

    try {
        const result = handler(payload);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            Promise.resolve(result).catch(error => {
                onError?.(error);
            });
        }
        return true;
    } catch (error) {
        onError?.(error);
        return false;
    }
}

function normalizeNonNegativeNumber(value: unknown) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

export function normalizePlaybackObserverProgress(
    progress: PlaybackObserverProgressInput,
): PlaybackObserverProgressData {
    return {
        currentTime: normalizeNonNegativeNumber(progress.position),
        duration: normalizeNonNegativeNumber(progress.duration),
    };
}

export function createPlaybackObserverSetupGuard() {
    let initialized = false;

    return () => {
        if (initialized) {
            return false;
        }

        initialized = true;
        return true;
    };
}
