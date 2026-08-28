import { emitErrorLog } from "@/utils/logTransport";

import {
    configureKeyValueStores,
    flushKeyValueStores,
    getKeyValueStore,
    hydrateKeyValueStores,
} from "./index";
import { migrateLegacyMMKVStore } from "../getOrCreateMMKV";

/**
 * 启动时必须预先载入的固定 store。
 *
 * 动态 store（`LocalSheet.<id>`、`MediaExtra.<plugin>`）不在此列：它们在各自
 * 模块首次访问时创建并自行 hydrate，数量随用户数据增长，不该拖慢启动。
 * 代价是这些 store 的首次同步读可能拿不到值——调用方本来就要处理"还没加载"
 * 的情况（歌单为空、没有额外元数据）。
 */
const EAGER_STORE_IDS = [
    "App.config",
    "App.PersistStatus",
    "App.meta",
    "App.lastfm",
    "plugin-meta",
    "plugin.cache",
    "plugin-storage",
    "plugin-diagnostics",
    "dislike-music",
    "lx-source",
    "music.MusicHistory",
    "music.DownloadTasks",
] as const;

/** 旧 MMKV 里的 cache 类 store 用了另一个物理路径。 */
const CACHE_STORE_IDS = ["cache.MediaCache"] as const;

let ready: Promise<void> | null = null;

/**
 * 在读取任何配置之前调用。
 *
 * 与 MMKV 的关键差异：MMKV 构造即同步完成 mmap，读取无需等待；文件存储必须
 * 先异步读盘。因此这一步要排在 bootstrap 里所有 `Config.getConfig` 之前，
 * 否则会读到空值并把默认值写回去，等于每次启动重置用户设置。
 */
export function setupKeyValueStores(): Promise<void> {
    ready ??= (async () => {
        configureKeyValueStores({
            onPersistError({ storeId, attempts, error }) {
                // 落盘彻底失败必须留痕。MMKV 时代这类失败完全静默，
                // 配置丢了很久都没人能查出原因。
                emitErrorLog(
                    "键值存储落盘失败",
                    { storeId, attempts, error: String(error) },
                    true,
                    false,
                );
            },
            onRecover({ storeId, reason }) {
                emitErrorLog(
                    "键值存储快照损坏已降级",
                    { storeId, reason },
                    true,
                    false,
                );
            },
        });

        // 先建实例（构造即触发 hydrate），再统一等待。
        [...EAGER_STORE_IDS, ...CACHE_STORE_IDS].forEach(id =>
            getKeyValueStore(id),
        );
        await hydrateKeyValueStores();

        // hydrate 完成后才能判断目标是否已有数据，因此迁移放在这里。
        // 逐个独立处理：任何一个 store 的迁移失败都不该阻断其余的。
        await Promise.all([
            ...EAGER_STORE_IDS.map(id =>
                migrateLegacyMMKVStore(id, false).catch(error => {
                    emitErrorLog(
                        "MMKV 迁移失败",
                        { storeId: id, error: String(error) },
                        true,
                        false,
                    );
                    return null;
                }),
            ),
            ...CACHE_STORE_IDS.map(id =>
                migrateLegacyMMKVStore(id, true).catch(() => null),
            ),
        ]);
    })();
    return ready;
}

/** 退出前尽力落盘，避免最后一批变更丢失。 */
export async function shutdownKeyValueStores() {
    try {
        await flushKeyValueStores();
    } catch (error) {
        emitErrorLog(
            "退出前落盘失败",
            { error: String(error) },
            true,
            false,
        );
    }
}
