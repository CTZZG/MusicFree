export type SerializedStateMutation<T> = (
    current: T,
) => T | Promise<T>;

interface ISerializedStateRepositoryOptions<T> {
    initialState: T;
    persist(next: Readonly<T>): Promise<void>;
    onCommit?(next: T): void;
}

/**
 * Serializes read-modify-write operations so every mutation observes the last
 * successfully persisted snapshot.
 */
export default class SerializedStateRepository<T> {
    private state: T;
    private operationTail: Promise<void> = Promise.resolve();
    private readonly persist: (
        next: Readonly<T>,
    ) => Promise<void>;
    private readonly onCommit?: (next: T) => void;

    constructor(options: ISerializedStateRepositoryOptions<T>) {
        this.state = options.initialState;
        this.persist = options.persist;
        this.onCommit = options.onCommit;
    }

    getSnapshot() {
        return this.state;
    }

    initialize(snapshot: T, notify = false) {
        this.state = snapshot;
        if (notify) {
            this.onCommit?.(snapshot);
        }
    }

    mutate(mutation: SerializedStateMutation<T>): Promise<T> {
        const operation = this.operationTail.then(async () => {
            const current = this.state;
            const next = await mutation(current);

            if (Object.is(next, current)) {
                return current;
            }

            await this.persist(next);
            this.state = next;
            this.onCommit?.(next);
            return next;
        });

        // A failed operation must not poison later queued mutations.
        this.operationTail = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    async flush() {
        await this.operationTail;
    }
}
