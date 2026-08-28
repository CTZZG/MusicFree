import pathConst from "@/constants/pathConst";
import { getKeyValueStore, hydrateKeyValueStore } from "./keyValueStore";
import type { IKeyValueStore } from "./keyValueStore";
import { migrateEntries, shouldMigrate } from "./keyValueStore/mmkvMigration";

/**
 * 键值存储的统一入口。
 *
 * 名字保留 `getOrCreateMMKV` 是为了不改动十几个调用点，但底层**已不再是
 * MMKV**。原因见 `keyValueStore/filePersistence.ts`：MMKV 依靠 mmap 把内存页
 * 写回文件，而本项目把它的数据目录放在外部存储（/sdcard/Android/data/...），
 * 那是 FUSE 挂载（sdcardfs/FuseDaemon），并不保证 mmap 的写回语义。表现就是
 * 配置在内存里改了、界面上也生效了，文件 mtime 却纹丝不动，重启后全部还原，
 * 而且整个过程没有任何错误可以观察到。
 *
 * 新实现：同步读写内存 + 合并后整份 JSON 原子落盘到应用**内部**存储。
 *
 * @param dbName store 标识
 * @param cachePath 兼容旧签名。新实现所有 store 都在同一目录下按 id 分文件；
 *   缓存类数据由各自的清理逻辑管理，不再需要单独的物理路径。
 */
const getOrCreateMMKV = (
    dbName: string,
    cachePath = false,
): IKeyValueStore => {
    const store = getKeyValueStore(dbName);
    void cachePath;
    return store;
};

/**
 * 把某个 store 的旧 MMKV 数据搬到新存储。
 *
 * 单独导出而不是在 getOrCreateMMKV 里隐式执行：迁移需要 hydrate 完成后才能
 * 判断目标是否已有数据，而 getOrCreateMMKV 是同步的。由 bootstrap 显式调用。
 */
export async function migrateLegacyMMKVStore(
    dbName: string,
    cachePath = false,
): Promise<{ migrated: boolean; keys: number } | null> {
    const target = getKeyValueStore(dbName);
    await target.hydrate();
    if (!shouldMigrate(target)) {
        return null;
    }

    try {
        // 延迟 require：只有真正需要迁移时才加载 MMKV，迁移完成后的正常启动
        // 完全不碰它。
        const { createMMKV } = require("react-native-mmkv");
        const legacy = createMMKV({
            id: dbName,
            path: cachePath ? pathConst.mmkvCachePath : pathConst.mmkvPath,
        });
        const result = migrateEntries(
            {
                getAllKeys: () => legacy.getAllKeys(),
                getString: (key: string) => legacy.getString(key),
                getNumber: (key: string) => legacy.getNumber(key),
                getBoolean: (key: string) => legacy.getBoolean(key),
            },
            target,
        );
        return { migrated: result.migrated, keys: result.keys };
    } catch {
        // MMKV 加载或打开失败：标记为已迁移，避免每次启动重试。旧数据取不到
        // 就当作没有——总比启动失败好。
        const { MIGRATION_FLAG_KEY } = require("./keyValueStore/mmkvMigration");
        target.set(MIGRATION_FLAG_KEY, "legacy-unavailable");
        return { migrated: false, keys: 0 };
    }
};

/**
 * 从此模块再导出，而不是让调用方直接 import keyValueStore：动态 store 的
 * 调用点（歌单、插件附加属性）在测试里 mock 的是本模块，从这里导出可以让
 * 同一份 mock 一并覆盖 hydrate，不必每个测试都额外 mock 文件系统。
 */
export { hydrateKeyValueStore };

export default getOrCreateMMKV;
