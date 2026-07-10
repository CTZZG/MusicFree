import type { DownloadWriteResult } from "./downloadFinalizationPolicy";
import {
    hasReachedDownloadFinalizationStage,
    type IDownloadFinalizationJournal,
} from "./downloadFinalizationJournal";

export interface IDownloadFinalizationOperations {
    assertCanContinue(): void;
    prepareArtifact(): Promise<void>;
    writeMetadata(): Promise<DownloadWriteResult>;
    writeLyric(): Promise<DownloadWriteResult>;
    indexLocalMusic(): Promise<void>;
    commitMediaExtra(journal: IDownloadFinalizationJournal): Promise<void>;
    verifyFinalArtifact(): Promise<void>;
    persistJournal(
        journal: IDownloadFinalizationJournal,
    ): IDownloadFinalizationJournal;
    cleanupCache(): Promise<void>;
    releaseReservation(): void;
    publishCompletion(): Promise<void>;
    cancelPublishedCompletion(): Promise<void>;
    removeNativeTask(): Promise<void>;
    completeTask(): void;
}

export async function runDownloadFinalizationTransaction(
    initialJournal: IDownloadFinalizationJournal,
    operations: IDownloadFinalizationOperations,
) {
    let journal = initialJournal;

    operations.assertCanContinue();
    if (!hasReachedDownloadFinalizationStage(journal.stage, "artifact-ready")) {
        await operations.prepareArtifact();
        operations.assertCanContinue();
        journal = operations.persistJournal({
            ...journal,
            stage: "artifact-ready",
        });
    }

    if (
        !hasReachedDownloadFinalizationStage(journal.stage, "metadata-written")
    ) {
        const metadataResult = await operations.writeMetadata();
        operations.assertCanContinue();
        journal = operations.persistJournal({
            ...journal,
            stage: "metadata-written",
            metadataResult,
        });
    }

    if (!hasReachedDownloadFinalizationStage(journal.stage, "lyric-written")) {
        const lyricResult = await operations.writeLyric();
        operations.assertCanContinue();
        journal = operations.persistJournal({
            ...journal,
            stage: "lyric-written",
            lyricResult,
        });
    }

    if (!hasReachedDownloadFinalizationStage(journal.stage, "indexed")) {
        await operations.indexLocalMusic();
        operations.assertCanContinue();
        journal = operations.persistJournal({ ...journal, stage: "indexed" });
    }

    if (
        !hasReachedDownloadFinalizationStage(
            journal.stage,
            "media-extra-committed",
        )
    ) {
        await operations.commitMediaExtra(journal);
        operations.assertCanContinue();
        journal = operations.persistJournal({
            ...journal,
            stage: "media-extra-committed",
        });
    }

    await operations.verifyFinalArtifact();
    operations.assertCanContinue();
    journal = operations.persistJournal({ ...journal, stage: "completed" });

    await operations.cleanupCache();
    operations.assertCanContinue();
    operations.releaseReservation();
    let completionPublished = false;
    try {
        await operations.publishCompletion();
        completionPublished = true;
        operations.assertCanContinue();
        await operations.removeNativeTask();
        operations.assertCanContinue();
        operations.completeTask();
    } catch (error) {
        if (completionPublished) {
            await operations.cancelPublishedCompletion();
        }
        throw error;
    }
    return journal;
}
