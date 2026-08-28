import { createFilePersistence, KV_STORE_DIR } from "./filePersistence";
import KeyValueStore, { type IKeyValueStoreOptions } from "./store";
import type { IKeyValueStore, IStorePersistence } from "./types";

export { KV_STORE_DIR };
export type { IKeyValueStore, IStorePersistence };
export { default as KeyValueStore } from "./store";

const stores = new Map<string, KeyValueStore>();
let persistence: IStorePersistence = createFilePersistence();
let sharedOptions: IKeyValueStoreOptions = {};

/**
 * 注入诊断回调。落盘失败与快照损坏都必须可观察——MMKV 时代这两类问题
 * 完全静默，配置丢了三个月都没人发现。
 */
export function configureKeyValueStores(options: {
    onPersistError?: IKeyValueStoreOptions["onPersistError"];
    onRecover?: IKeyValueStoreOptions["onRecover"];
}) {
    sharedOptions = { ...sharedOptions, ...options };
}

/** 仅供测试替换后端。 */
export function setKeyValueStorePersistenceForTests(
    next: IStorePersistence,
) {
    persistence = next;
    stores.clear();
}

export function getKeyValueStore(storeId: string): KeyValueStore {
    let store = stores.get(storeId);
    if (!store) {
        store = new KeyValueStore(storeId, persistence, sharedOptions);
        stores.set(storeId, store);
        // 立即开始 hydrate。同步读在 hydrate 完成前返回 undefined，因此
        // bootstrap 必须先 await hydrateKeyValueStores() 再读配置。
        void store.hydrate();
    }
    return store;
}

/** 等待已创建的 store 全部从磁盘载入。 */
export async function hydrateKeyValueStores() {
    await Promise.all([...stores.values()].map(store => store.hydrate()));
}

/** 退出前把所有待写变更落盘。 */
export async function flushKeyValueStores() {
    await Promise.all([...stores.values()].map(store => store.flush()));
}

export function listKeyValueStoreIds() {
    return [...stores.keys()];
}
