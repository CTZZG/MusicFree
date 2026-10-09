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
    /**
     * 把最近一次 persistJournal 的结果真正写到磁盘，返回是否写成功。
     *
     * persistJournal 只改内存，落盘是合并延迟的（最多约 1 秒）。删除缓存之类
     * 不可逆的操作之前必须等它：否则进程在这之间被杀，磁盘上还是更早的阶段，
     * 重启恢复看到缓存没了就回滚，回滚会把已经做好的最终文件一起删掉。
     */
    commitJournal(): Promise<boolean>;
    cleanupCache(): Promise<void>;
    /** 收尾日志没能写到磁盘、缓存因此保留时上报。 */
    reportCacheKept?(): void;
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
        // 开始写最终文件之前，让“准备收尾”（含最终路径）先落盘：进程在这之后
        // 被杀，重启时才知道有这个文件要接着做或回滚，不会留下没人管的文件
        await operations.commitJournal();
        operations.assertCanContinue();
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

    // “已完成”必须先落盘，才能删恢复所需的缓存。写不进去就保留缓存：多一个
    // 临时文件，好过重启后按旧日志回滚、把做好的歌删掉
    const completedOnDisk = await operations.commitJournal();
    operations.assertCanContinue();
    if (completedOnDisk) {
        await operations.cleanupCache();
    } else {
        operations.reportCacheKept?.();
    }
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
