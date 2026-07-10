export interface IDownloadAttemptIdentity {
    logicalKey: string;
    attemptId: string;
}

export function createDownloadAttemptIdentity(
    logicalKey: string,
    createAttemptId: () => string,
): IDownloadAttemptIdentity {
    return {
        logicalKey,
        attemptId: createAttemptId(),
    };
}

export function isSameDownloadAttempt(
    task: IDownloadAttemptIdentity | null | undefined,
    identity: IDownloadAttemptIdentity,
) {
    return (
        task?.logicalKey === identity.logicalKey &&
        task.attemptId === identity.attemptId
    );
}

interface IDownloadTaskRetentionOptions<T> {
    maxTerminalHistory: number;
    isTerminal(task: T): boolean;
    getTerminalOrder?(task: T): number;
}

export function splitDownloadTaskRetention<T>(
    tasks: readonly T[],
    options: IDownloadTaskRetentionOptions<T>,
) {
    const active: T[] = [];
    const terminal: T[] = [];

    tasks.forEach(task => {
        if (options.isTerminal(task)) {
            terminal.push(task);
        } else {
            active.push(task);
        }
    });

    const maxTerminalHistory = Math.max(
        0,
        Math.floor(options.maxTerminalHistory),
    );
    const orderedTerminal = options.getTerminalOrder
        ? terminal
            .map((task, index) => ({
                task,
                index,
                order: options.getTerminalOrder!(task),
            }))
            .sort((left, right) =>
                left.order === right.order
                    ? left.index - right.index
                    : left.order - right.order,
            )
            .map(item => item.task)
        : terminal;

    return {
        active,
        terminal:
            maxTerminalHistory === 0
                ? []
                : orderedTerminal.slice(-maxTerminalHistory),
    };
}
