import type { IDownloadFinalizationJournal } from "../downloadFinalizationJournal";
import {
    type IDownloadFinalizationOperations,
    runDownloadFinalizationTransaction,
} from "../downloadFinalizationRunner";

const initialJournal = (): IDownloadFinalizationJournal => ({
    stage: "prepared",
    cachePath: "/cache/attempt.part",
    targetPath: "/music/song.mp3",
    sidecarPaths: ["/music/song.lrc"],
});

const awaitedOperations = [
    "prepareArtifact",
    "writeMetadata",
    "writeLyric",
    "indexLocalMusic",
    "commitMediaExtra",
    "verifyFinalArtifact",
    "cleanupCache",
    "publishCompletion",
    "removeNativeTask",
] as const;

function createOperations(cancelAfter?: (typeof awaitedOperations)[number]) {
    let cancelled = false;
    const calls: string[] = [];
    const persisted: IDownloadFinalizationJournal[] = [];
    const completeTask = jest.fn();
    const cancelPublishedCompletion = jest.fn(async () => undefined);
    const operation = <T>(name: (typeof awaitedOperations)[number], value: T) =>
        jest.fn(async () => {
            calls.push(name);
            if (cancelAfter === name) {
                cancelled = true;
            }
            return value;
        });

    const operations: IDownloadFinalizationOperations = {
        assertCanContinue() {
            if (cancelled) {
                throw new Error("Download finalization cancelled");
            }
        },
        prepareArtifact: operation("prepareArtifact", undefined),
        writeMetadata: operation("writeMetadata", "success" as const),
        writeLyric: operation("writeLyric", "skipped-no-content" as const),
        indexLocalMusic: operation("indexLocalMusic", undefined),
        commitMediaExtra: operation("commitMediaExtra", undefined),
        verifyFinalArtifact: operation("verifyFinalArtifact", undefined),
        persistJournal(journal) {
            persisted.push(journal);
            return journal;
        },
        cleanupCache: operation("cleanupCache", undefined),
        releaseReservation: jest.fn(() => calls.push("releaseReservation")),
        publishCompletion: operation("publishCompletion", undefined),
        cancelPublishedCompletion,
        removeNativeTask: operation("removeNativeTask", undefined),
        completeTask,
    };

    return {
        operations,
        calls,
        persisted,
        completeTask,
        cancelPublishedCompletion,
    };
}

describe("runDownloadFinalizationTransaction", () => {
    it("persists every checkpoint before publishing completion", async () => {
        const fixture = createOperations();

        await expect(
            runDownloadFinalizationTransaction(
                initialJournal(),
                fixture.operations,
            ),
        ).resolves.toMatchObject({ stage: "completed" });

        expect(fixture.persisted.map(item => item.stage)).toEqual([
            "artifact-ready",
            "metadata-written",
            "lyric-written",
            "indexed",
            "media-extra-committed",
            "completed",
        ]);
        expect(fixture.calls).toEqual([
            "prepareArtifact",
            "writeMetadata",
            "writeLyric",
            "indexLocalMusic",
            "commitMediaExtra",
            "verifyFinalArtifact",
            "cleanupCache",
            "releaseReservation",
            "publishCompletion",
            "removeNativeTask",
        ]);
        expect(fixture.completeTask).toHaveBeenCalledTimes(1);
    });

    it.each(awaitedOperations)(
        "stops after cancellation injected at %s",
        async operationName => {
            const fixture = createOperations(operationName);

            await expect(
                runDownloadFinalizationTransaction(
                    initialJournal(),
                    fixture.operations,
                ),
            ).rejects.toThrow("Download finalization cancelled");
            expect(fixture.completeTask).not.toHaveBeenCalled();

            const operationIndex = fixture.calls.indexOf(operationName);
            expect(operationIndex).toBeGreaterThanOrEqual(0);
            expect(fixture.calls.slice(operationIndex + 1)).toEqual(
                operationName === "publishCompletion" ? [] : [],
            );
            expect(fixture.cancelPublishedCompletion).toHaveBeenCalledTimes(
                awaitedOperations.indexOf(operationName) >=
                    awaitedOperations.indexOf("publishCompletion")
                    ? 1
                    : 0,
            );
        },
    );

    it.each([
        "artifact-ready",
        "metadata-written",
        "lyric-written",
        "indexed",
        "media-extra-committed",
        "completed",
    ] as const)(
        "does not execute work after persistence fails at %s",
        async failedStage => {
            const fixture = createOperations();
            fixture.operations.persistJournal = jest.fn(nextJournal => {
                if (nextJournal.stage === failedStage) {
                    throw new Error(`persist failed at ${failedStage}`);
                }
                fixture.persisted.push(nextJournal);
                return nextJournal;
            });

            await expect(
                runDownloadFinalizationTransaction(
                    initialJournal(),
                    fixture.operations,
                ),
            ).rejects.toThrow(`persist failed at ${failedStage}`);
            expect(fixture.completeTask).not.toHaveBeenCalled();
            expect(fixture.calls).not.toContain("removeNativeTask");
            expect(fixture.cancelPublishedCompletion).not.toHaveBeenCalled();
        },
    );

    it("cancels a published completion when native task confirmation fails", async () => {
        const fixture = createOperations();
        fixture.operations.removeNativeTask = jest.fn(async () => {
            fixture.calls.push("removeNativeTask");
            throw new Error("native bridge unavailable");
        });

        await expect(
            runDownloadFinalizationTransaction(
                initialJournal(),
                fixture.operations,
            ),
        ).rejects.toThrow("native bridge unavailable");
        expect(fixture.cancelPublishedCompletion).toHaveBeenCalledTimes(1);
        expect(fixture.completeTask).not.toHaveBeenCalled();
    });

    it("leaves the last committed journal intact when indexing storage rejects", async () => {
        const fixture = createOperations();
        fixture.operations.indexLocalMusic = jest.fn(async () => {
            throw new Error("storage full");
        });

        await expect(
            runDownloadFinalizationTransaction(
                initialJournal(),
                fixture.operations,
            ),
        ).rejects.toThrow("storage full");
        expect(fixture.persisted.at(-1)?.stage).toBe("lyric-written");
        expect(fixture.completeTask).not.toHaveBeenCalled();
    });

    it("resumes a completed checkpoint without repeating content writes", async () => {
        const fixture = createOperations();

        await runDownloadFinalizationTransaction(
            { ...initialJournal(), stage: "completed" },
            fixture.operations,
        );

        expect(fixture.calls).toEqual([
            "verifyFinalArtifact",
            "cleanupCache",
            "releaseReservation",
            "publishCompletion",
            "removeNativeTask",
        ]);
        expect(fixture.completeTask).toHaveBeenCalledTimes(1);
    });
});
