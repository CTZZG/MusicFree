import type { IKeyValueStore } from "./types";

/**
 * 从 MMKV 迁移到文件存储的策略层（纯逻辑，不碰 MMKV 也不碰文件系统）。
 *
 * 迁移只做一次，用目标 store 里的一个标记键判定。这个标记必须写在**目标**
 * 而不是源：如果写在 MMKV 里，而 MMKV 本身正是写不进去的那一方（外部存储上
 * mmap 写不回），标记会丢，于是每次启动都重新迁移，反复用旧数据覆盖新数据。
 */
export const MIGRATION_FLAG_KEY = "$migratedFromMMKV";

export interface IMigrationSource {
    getAllKeys(): string[];
    getString(key: string): string | undefined;
    getNumber(key: string): number | undefined;
    getBoolean(key: string): boolean | undefined;
}

export interface IMigrationResult {
    migrated: boolean;
    keys: number;
    skipped: number;
    reason?: string;
}

export function shouldMigrate(target: IKeyValueStore): boolean {
    return !target.contains(MIGRATION_FLAG_KEY);
}

/**
 * 把源里的键逐个搬到目标。
 *
 * 目标里已存在的键**不覆盖**：那说明新存储已经有更新的值（比如迁移后用户
 * 改过设置，而某次异常又让标记没写上），用旧数据盖掉是净损失。
 */
export function migrateEntries(
    source: IMigrationSource,
    target: IKeyValueStore,
): IMigrationResult {
    let keys = 0;
    let skipped = 0;

    let sourceKeys: string[];
    try {
        sourceKeys = source.getAllKeys();
    } catch (error) {
        // 源读不出来（MMKV 实例损坏就是这种情况）也要落下标记，否则每次
        // 启动都重试一遍失败的迁移。
        target.set(MIGRATION_FLAG_KEY, `failed:${String(
            (error as any)?.message ?? error,
        )}`);
        return {
            migrated: false,
            keys: 0,
            skipped: 0,
            reason: "source-unreadable",
        };
    }

    for (const key of sourceKeys) {
        if (key === MIGRATION_FLAG_KEY) {
            continue;
        }
        if (target.contains(key)) {
            skipped += 1;
            continue;
        }
        // 逐类型尝试。MMKV 不暴露值的类型，只能按可能性依次探测。
        try {
            const asString = source.getString(key);
            if (asString !== undefined) {
                target.set(key, asString);
                keys += 1;
                continue;
            }
            const asNumber = source.getNumber(key);
            if (asNumber !== undefined) {
                target.set(key, asNumber);
                keys += 1;
                continue;
            }
            const asBoolean = source.getBoolean(key);
            if (asBoolean !== undefined) {
                target.set(key, asBoolean);
                keys += 1;
                continue;
            }
            skipped += 1;
        } catch {
            // 单个键读失败不该中断整份迁移。
            skipped += 1;
        }
    }

    target.set(MIGRATION_FLAG_KEY, new Date().toISOString());
    return { migrated: true, keys, skipped };
}
