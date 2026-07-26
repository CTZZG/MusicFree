export default function createDelayedAction(
    callback: () => void,
    delayMs: number,
) {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
    };

    const schedule = () => {
        cancel();
        timeout = setTimeout(() => {
            timeout = undefined;
            callback();
        }, delayMs);
    };

    return {
        cancel,
        schedule,
    };
}
