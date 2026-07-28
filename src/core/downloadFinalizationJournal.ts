import type { DownloadWriteResult } from "./downloadFinalizationPolicy";

export const QMC_OUTPUT_TEMP_SUFFIX = ".qmc-temp";
export const QMC_OUTPUT_BACKUP_SUFFIX = ".qmc-backup";

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

export type DownloadDecryptionDescriptor =
    | {
          scheme: "cenc";
          key: string;
      }
    | {
          scheme: "qmc";
          ekey?: string;
          /** Persisted probe result used to reject a differently decoded container. */
          outputExtension?: string;
      };

export interface IDownloadFinalizationJournal {
    stage: DownloadFinalizationStage;
    cachePath: string;
    targetPath: string;
    sidecarPaths: string[];
    decryption?: DownloadDecryptionDescriptor;
    /** @deprecated Legacy persisted journals used only this flag. */
    requiresDecryption?: boolean;
    metadataResult?: DownloadWriteResult;
    lyricResult?: DownloadWriteResult;
    cancelRequested?: boolean;
    rollbackRequested?: boolean;
}

function isDownloadDecryptionDescriptor(
    value: unknown,
): value is DownloadDecryptionDescriptor {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const descriptor = value as Partial<DownloadDecryptionDescriptor> & {
        key?: unknown;
        ekey?: unknown;
        outputExtension?: unknown;
    };
    if (descriptor.scheme === "cenc") {
        return (
            typeof descriptor.key === "string" &&
            /^[0-9a-fA-F]{32}$/.test(descriptor.key)
        );
    }
    if (descriptor.scheme === "qmc") {
        return (
            (descriptor.ekey === undefined ||
                (typeof descriptor.ekey === "string" &&
                    descriptor.ekey.trim().length > 0 &&
                    descriptor.ekey.length <= 64 * 1024)) &&
            (descriptor.outputExtension === undefined ||
                (typeof descriptor.outputExtension === "string" &&
                    ["flac", "ogg", "mp3", "m4a", "wav"].includes(
                        descriptor.outputExtension,
                    )))
        );
    }
    return false;
}

function getTargetExtension(targetPath: string) {
    return /\.([^./\\]+)$/.exec(targetPath)?.[1]?.toLowerCase() ?? "";
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
        (journal.decryption === undefined ||
            isDownloadDecryptionDescriptor(journal.decryption)) &&
        (journal.decryption?.scheme !== "qmc" ||
            journal.decryption.outputExtension === undefined ||
            journal.decryption.outputExtension ===
                getTargetExtension(journal.targetPath)) &&
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
    const qmcReplacementPaths = journal.decryption?.scheme === "qmc"
        ? [
            `${journal.targetPath}${QMC_OUTPUT_TEMP_SUFFIX}`,
            `${journal.targetPath}${QMC_OUTPUT_BACKUP_SUFFIX}`,
        ]
        : [];
    return [
        journal.cachePath,
        journal.targetPath,
        ...qmcReplacementPaths,
        ...journal.sidecarPaths,
    ]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);
}
