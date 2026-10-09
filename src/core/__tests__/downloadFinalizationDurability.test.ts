// 复核 4b4b833b（P2）：收尾日志写“已完成”只改了内存（合并延迟落盘），随后马上
// 删了缓存。进程在这之间被杀，磁盘上还是“准备收尾”，重启恢复看到缓存没了就
// 回滚，回滚路径里有已经做好的最终文件。
//
// 真实的收尾事务、真实的键值存储和真实的恢复判断；平时的合并写盘暂停（定时器
// 不触发），只有显式提交会落盘，在删缓存的那一刻读磁盘上的日志。

import type { IDownloadFinalizationJournal } from "../downloadFinalizationJournal";
import {
    getDownloadFinalizationRollbackPaths,
    resolveDownloadFinalizationRecovery,
} from "../downloadFinalizationJournal";
import {
    type IDownloadFinalizationOperations,
    runDownloadFinalizationTransaction,
} from "../downloadFinalizationRunner";
import KeyValueStore from "@/utils/keyValueStore/store";
import { decodeSnapshot } from "@/utils/keyValueStore/snapshotCodec";
import type { IStorePersistence } from "@/utils/keyValueStore/types";

const journal = (): IDownloadFinalizationJournal => ({
    stage: "prepared",
    cachePath: "/cache/attempt.part",
    targetPath: "/music/song.mp3",
    sidecarPaths: ["/music/song.lrc"],
});

function setup(options: { failWrites?: () => boolean } = {}) {
    const disk = new Map<string, string>();
    const persistence: IStorePersistence = {
        read: async id => disk.get(id) ?? null,
        write: async (id, contents) => {
            if (options.failWrites?.()) {
                throw new Error("disk full");
            }
            disk.set(id, contents);
        },
        remove: async id => {
            disk.delete(id);
        },
    };
    // 合并写盘不触发：模拟“已经写进内存、还没来得及落盘”
    const store = new KeyValueStore("music.DownloadTasks", persistence, {
        setTimer: () => 0,
        clearTimer: () => undefined,
        retryDelaysMs: [],
    });
    const files = new Set(["/cache/attempt.part"]);
    const journalOnDisk = (): IDownloadFinalizationJournal | null => {
        const raw = disk.get("music.DownloadTasks");
        const entry = raw ? decodeSnapshot(raw).entries.journal : undefined;
        return entry && entry.t === "s" ? JSON.parse(entry.v) : null;
    };
    const noop = async () => undefined;
    const crashPoints: Record<string, IDownloadFinalizationJournal | null> = {};
    const operations: IDownloadFinalizationOperations = {
        assertCanContinue: () => undefined,
        prepareArtifact: async () => {
            crashPoints.beforeTarget = journalOnDisk();
            files.add("/music/song.mp3");
        },
        writeMetadata: async () => "success",
        writeLyric: async () => "skipped-no-content",
        indexLocalMusic: noop,
        commitMediaExtra: noop,
        verifyFinalArtifact: noop,
        persistJournal: next => {
            store.set("journal", JSON.stringify(next));
            return next;
        },
        commitJournal: () => store.flush(),
        cleanupCache: async () => {
            files.delete("/cache/attempt.part");
            // 进程恰好在删完缓存后被杀：重启时看到的就是这一刻的磁盘
            crashPoints.afterCacheDeleted = journalOnDisk();
        },
        releaseReservation: () => undefined,
        publishCompletion: noop,
        cancelPublishedCompletion: noop,
        removeNativeTask: noop,
        completeTask: () => undefined,
    };
    return { store, files, operations, crashPoints };
}

describe("download finalization across a crash", () => {
    it("does not roll back a finished song when the process dies right after the cache is deleted", async () => {
        const { store, files, operations, crashPoints } = setup();
        await store.hydrate();
        // 下载器在进入收尾时记下“准备收尾”
        operations.persistJournal(journal());

        await runDownloadFinalizationTransaction(journal(), operations);

        const recovered = crashPoints.afterCacheDeleted!;
        expect(recovered.stage).toBe("completed");
        const decision = resolveDownloadFinalizationRecovery({
            journal: recovered,
            cacheExists: files.has(recovered.cachePath),
            targetExists: files.has(recovered.targetPath),
        });
        expect(decision).toEqual({ action: "complete" });
    });

    it("records the final path on disk before writing the final file", async () => {
        const { store, operations, crashPoints } = setup();
        await store.hydrate();
        operations.persistJournal(journal());

        await runDownloadFinalizationTransaction(journal(), operations);

        expect(crashPoints.beforeTarget).toMatchObject({
            stage: "prepared",
            targetPath: "/music/song.mp3",
        });
    });

    it("keeps the cache when the completed journal cannot be written", async () => {
        let failing = false;
        const { store, files, operations } = setup({ failWrites: () => failing });
        await store.hydrate();
        operations.persistJournal(journal());
        const verify = operations.verifyFinalArtifact;
        operations.verifyFinalArtifact = async () => {
            await verify();
            failing = true; // 从写“已完成”开始磁盘写不进去
        };

        await runDownloadFinalizationTransaction(journal(), operations);

        // 缓存还在：重启时按磁盘上的旧日志可以接着收尾，而不是回滚删歌
        expect(files.has("/cache/attempt.part")).toBe(true);
        expect(files.has("/music/song.mp3")).toBe(true);
    });

    // 对照：不等落盘就删缓存，恢复会回滚并删掉最终文件（复核的复现）
    it("shows the rollback that a stale on-disk journal would cause", () => {
        const stale = journal();
        const decision = resolveDownloadFinalizationRecovery({
            journal: stale,
            cacheExists: false,
            targetExists: true,
        });
        expect(decision).toEqual({ action: "rollback", reason: "artifacts-missing" });
        expect(getDownloadFinalizationRollbackPaths(stale)).toContain("/music/song.mp3");
    });
});
