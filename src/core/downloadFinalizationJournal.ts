import type { DownloadWriteResult } from "./downloadFinalizationPolicy";

export const downloadFinalizationStages = [
    "prepared",
    "artifact-ready",
    "metadata-written",
    "lyric-written",
    "indexed",
    "media-extra-committed",
    "completed",
] as const;

export type DownloadFinalizationStage =
    (typeof downloadFinalizationStages)[number];

export interface IDownloadFinalizationJournal {
    stage: DownloadFinalizationStage;
    cachePath: string;
    targetPath: string;
    sidecarPaths: string[];
    requiresDecryption?: boolean;
    metadataResult?: DownloadWriteResult;
    lyricResult?: DownloadWriteResult;
    cancelRequested?: boolean;
    rollbackRequested?: boolean;
}


export function isDownloadFinalizationJournal(
    value: unknown,
): value is IDownloadFinalizationJournal {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const journal = value as Partial<IDownloadFinalizationJournal>;
    return (
        downloadFinalizationStages.includes(journal.stage as any) &&
        typeof journal.cachePath === "string" &&
        journal.cachePath.length > 0 &&
        typeof journal.targetPath === "string" &&
        journal.targetPath.length > 0 &&
        Array.isArray(journal.sidecarPaths) &&
        journal.sidecarPaths.every(path => typeof path === "string") &&
        (journal.requiresDecryption === undefined ||
            typeof journal.requiresDecryption === "boolean") &&
        (journal.cancelRequested === undefined ||
            typeof journal.cancelRequested === "boolean") &&
        (journal.rollbackRequested === undefined ||
            typeof journal.rollbackRequested === "boolean")
    );
}

export type DownloadFinalizationRecoveryDecision =
    | {action: "continue"; from: DownloadFinalizationStage}
    | {
          action: "rollback";
          reason: "cancelled" | "failed" | "artifacts-missing";
      }
    | {action: "complete"};

export function getDownloadFinalizationStageIndex(
    stage: DownloadFinalizationStage,
) {
    return downloadFinalizationStages.indexOf(stage);
}

export function hasReachedDownloadFinalizationStage(
    current: DownloadFinalizationStage,
    expected: DownloadFinalizationStage,
) {
    return (
        getDownloadFinalizationStageIndex(current) >=
        getDownloadFinalizationStageIndex(expected)
    );
}

export function resolveDownloadFinalizationRecovery(input: {
    journal: IDownloadFinalizationJournal;
    cacheExists: boolean;
    targetExists: boolean;
}): DownloadFinalizationRecoveryDecision {
    const { journal, cacheExists, targetExists } = input;
    if (journal.cancelRequested) {
        return { action: "rollback", reason: "cancelled" };
    }
    if (journal.rollbackRequested) {
        return { action: "rollback", reason: "failed" };
    }
    if (journal.stage === "completed") {
        return targetExists
            ? { action: "complete" }
            : { action: "rollback", reason: "artifacts-missing" };
    }

    if (journal.stage === "prepared") {
        return cacheExists
            ? { action: "continue", from: "prepared" }
            : { action: "rollback", reason: "artifacts-missing" };
    }

    if (targetExists) {
        return { action: "continue", from: journal.stage };
    }
    if (cacheExists) {
        return { action: "continue", from: "prepared" };
    }
    return { action: "rollback", reason: "artifacts-missing" };
}

export function getDownloadFinalizationRollbackPaths(
    journal: IDownloadFinalizationJournal,
) {
    return [journal.cachePath, journal.targetPath, ...journal.sidecarPaths]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);
}
