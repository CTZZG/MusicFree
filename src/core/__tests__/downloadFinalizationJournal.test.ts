import {
    downloadFinalizationStages,
    getDownloadFinalizationRollbackPaths,
    hasReachedDownloadFinalizationStage,
    IDownloadFinalizationJournal,
    isDownloadFinalizationJournal,
    resolveDownloadFinalizationRecovery,
} from "../downloadFinalizationJournal";

const journal = (
    patch: Partial<IDownloadFinalizationJournal> = {},
): IDownloadFinalizationJournal => ({
    stage: "prepared",
    cachePath: "/cache/attempt.part",
    targetPath: "/music/song.mp3",
    sidecarPaths: ["/music/song.lrc", "/music/song.txt"],
    ...patch,
});

describe("download finalization journal", () => {
    it.each(downloadFinalizationStages)(
        "rolls back cancellation restored at %s",
        stage => {
            expect(
                resolveDownloadFinalizationRecovery({
                    journal: journal({ stage, cancelRequested: true }),
                    cacheExists: true,
                    targetExists: true,
                }),
            ).toEqual({ action: "rollback", reason: "cancelled" });
        },
    );

    it.each(downloadFinalizationStages)(
        "retries a previously failed rollback restored at %s",
        stage => {
            expect(
                resolveDownloadFinalizationRecovery({
                    journal: journal({ stage, rollbackRequested: true }),
                    cacheExists: true,
                    targetExists: true,
                }),
            ).toEqual({ action: "rollback", reason: "failed" });
        },
    );
    it("continues a prepared attempt only when its cache survived", () => {
        expect(
            resolveDownloadFinalizationRecovery({
                journal: journal(),
                cacheExists: true,
                targetExists: false,
            }),
        ).toEqual({ action: "continue", from: "prepared" });
        expect(
            resolveDownloadFinalizationRecovery({
                journal: journal(),
                cacheExists: false,
                targetExists: false,
            }),
        ).toEqual({ action: "rollback", reason: "artifacts-missing" });
    });

    it.each(downloadFinalizationStages.slice(1, -1))(
        "resumes from persisted stage %s when the target survived",
        stage => {
            expect(
                resolveDownloadFinalizationRecovery({
                    journal: journal({ stage }),
                    cacheExists: false,
                    targetExists: true,
                }),
            ).toEqual({ action: "continue", from: stage });
        },
    );

    it("rebuilds a missing target from cache after a mid-stage kill", () => {
        expect(
            resolveDownloadFinalizationRecovery({
                journal: journal({ stage: "indexed" }),
                cacheExists: true,
                targetExists: false,
            }),
        ).toEqual({ action: "continue", from: "prepared" });
    });

    it("recognizes completed checkpoints only with a surviving artifact", () => {
        expect(
            resolveDownloadFinalizationRecovery({
                journal: journal({ stage: "completed" }),
                cacheExists: false,
                targetExists: true,
            }),
        ).toEqual({ action: "complete" });
        expect(
            resolveDownloadFinalizationRecovery({
                journal: journal({ stage: "completed" }),
                cacheExists: false,
                targetExists: false,
            }),
        ).toEqual({ action: "rollback", reason: "artifacts-missing" });
    });

    it("tracks monotonic stage progress and complete rollback artifacts", () => {
        expect(
            hasReachedDownloadFinalizationStage("indexed", "artifact-ready"),
        ).toBe(true);
        expect(hasReachedDownloadFinalizationStage("prepared", "indexed")).toBe(
            false,
        );
        expect(
            getDownloadFinalizationRollbackPaths(
                journal({
                    sidecarPaths: [
                        "/music/song.lrc",
                        "/music/song.lrc",
                        "/music/song.txt",
                    ],
                }),
            ),
        ).toEqual([
            "/cache/attempt.part",
            "/music/song.mp3",
            "/music/song.lrc",
            "/music/song.txt",
        ]);
    });
});


describe("isDownloadFinalizationJournal", () => {
    it("accepts a complete persisted journal", () => {
        expect(isDownloadFinalizationJournal(journal())).toBe(true);
    });

    it.each([
        null,
        {},
        { ...journal(), stage: "unknown" },
        { ...journal(), cachePath: undefined },
        { ...journal(), targetPath: "" },
        { ...journal(), sidecarPaths: [null] },
    ])("rejects an invalid persisted journal %#", value => {
        expect(isDownloadFinalizationJournal(value)).toBe(false);
    });
});
