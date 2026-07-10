import SerializedStateRepository from "../serializedStateRepository";

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("SerializedStateRepository", () => {
    it("serializes concurrent mutations against the latest committed state", async () => {
        const firstWrite = deferred();
        const firstWriteStarted = deferred();
        const persisted: string[][] = [];
        let writeCount = 0;
        const repository = new SerializedStateRepository<string[]>({
            initialState: [],
            async persist(next) {
                writeCount += 1;
                persisted.push([...next]);
                if (writeCount === 1) {
                    firstWriteStarted.resolve();
                    await firstWrite.promise;
                }
            },
        });

        const addFirst = repository.mutate(current => [...current, "first"]);
        const addSecond = repository.mutate(current => [...current, "second"]);

        await firstWriteStarted.promise;
        expect(persisted).toEqual([["first"]]);

        firstWrite.resolve();
        await Promise.all([addFirst, addSecond]);

        expect(persisted).toEqual([
            ["first"],
            ["first", "second"],
        ]);
        expect(repository.getSnapshot()).toEqual(["first", "second"]);
    });

    it("resolves a mutation only after persistence and commit", async () => {
        const write = deferred();
        const commits: number[][] = [];
        const repository = new SerializedStateRepository<number[]>({
            initialState: [],
            persist: () => write.promise,
            onCommit: next => commits.push([...next]),
        });

        let resolved = false;
        const operation = repository.mutate(current => [...current, 1]);
        void operation.then(() => {
            resolved = true;
        });

        await Promise.resolve();
        expect(resolved).toBe(false);
        expect(repository.getSnapshot()).toEqual([]);
        expect(commits).toEqual([]);

        write.resolve();
        await operation;

        expect(resolved).toBe(true);
        expect(repository.getSnapshot()).toEqual([1]);
        expect(commits).toEqual([[1]]);
    });

    it("keeps the committed snapshot and continues after a rejected write", async () => {
        const storageError = new Error("storage full");
        const persist = jest
            .fn<Promise<void>, [Readonly<number[]>]>()
            .mockRejectedValueOnce(storageError)
            .mockResolvedValue(undefined);
        const repository = new SerializedStateRepository<number[]>({
            initialState: [1],
            persist,
        });

        await expect(
            repository.mutate(current => [...current, 2]),
        ).rejects.toBe(storageError);
        expect(repository.getSnapshot()).toEqual([1]);

        await expect(
            repository.mutate(current => [...current, 3]),
        ).resolves.toEqual([1, 3]);
        expect(repository.getSnapshot()).toEqual([1, 3]);
    });

    it("preserves remove-then-add ordering under concurrent calls", async () => {
        const repository = new SerializedStateRepository<string[]>({
            initialState: ["old"],
            persist: async () => undefined,
        });

        const remove = repository.mutate(current =>
            current.filter(item => item !== "old"),
        );
        const add = repository.mutate(current => [...current, "new"]);

        await Promise.all([remove, add]);
        expect(repository.getSnapshot()).toEqual(["new"]);
    });
});
