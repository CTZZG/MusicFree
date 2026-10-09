import { createFilePersistence, KV_STORE_DIR } from "./filePersistence";
import KeyValueStore, { type IKeyValueStoreOptions } from "./store";
import type { IKeyValueStore, IStorePersistence } from "./types";

export { KV_STORE_DIR };
export type { IKeyValueStore, IStorePersistence };
export { default as KeyValueStore } from "./store";

type PersistErrorInfo = Parameters<NonNullable<IKeyValueStoreOptions["onPersistError"]>>[0];
type RecoverInfo = Parameters<NonNullable<IKeyValueStoreOptions["onRecover"]>>[0];

const stores = new Map<string, KeyValueStore>();
let persistence: IStorePersistence = createFilePersistence();
let diagnostics: {
    onPersistError?: IKeyValueStoreOptions["onPersistError"];
    onRecover?: IKeyValueStoreOptions["onRecover"];
} = {};

/** 诊断回调注册之前发生的事件，注册时补报。只留最近几条，防止无限增长。 */
const MAX_EARLY_EVENTS = 20;
const earlyEvents: Array<
    | { kind: "persistError"; info: PersistErrorInfo }
    | { kind: "recover"; info: RecoverInfo }
> = [];

function rememberEarly(event: (typeof earlyEvents)[number]) {
    earlyEvents.push(event);
    if (earlyEvents.length > MAX_EARLY_EVENTS) {
        earlyEvents.shift();
    }
}

/**
 * 每个 store 拿到的都是这一份：回调在触发时才去查当前注册的诊断函数。
 *
 * 以前每个 store 构造时拿到的是当时的选项对象，而 App.config 等 store 在模块
 * 导入时就建好了，比 bootstrap 注册诊断回调早——它们读盘损坏、落盘彻底失败
 * 都不会留下任何日志。
 */
const storeOptions: IKeyValueStoreOptions = {
    onPersistError(info) {
        if (diagnostics.onPersistError) {
            diagnostics.onPersistError(info);
        } else {
            rememberEarly({ kind: "persistError", info });
        }
    },
    onRecover(info) {
        if (diagnostics.onRecover) {
            diagnostics.onRecover(info);
        } else {
            rememberEarly({ kind: "recover", info });
        }
    },
};

/**
 * 注入诊断回调。落盘失败与快照损坏都必须可观察——MMKV 时代这两类问题
 * 完全静默，配置丢了三个月都没人发现。对已经建好的 store 同样生效，注册
 * 之前发生的事件在这里补报。
 */
export function configureKeyValueStores(options: {
    onPersistError?: IKeyValueStoreOptions["onPersistError"];
    onRecover?: IKeyValueStoreOptions["onRecover"];
}) {
    diagnostics = { ...diagnostics, ...options };
    const pending = earlyEvents.splice(0);
    for (const event of pending) {
        if (event.kind === "persistError" && diagnostics.onPersistError) {
            diagnostics.onPersistError(event.info);
        } else if (event.kind === "recover" && diagnostics.onRecover) {
            diagnostics.onRecover(event.info);
        } else {
            rememberEarly(event);
        }
    }
}

/** 仅供测试替换后端。 */
export function setKeyValueStorePersistenceForTests(
    next: IStorePersistence,
) {
    persistence = next;
    stores.clear();
    diagnostics = {};
    earlyEvents.splice(0);
}

export function getKeyValueStore(storeId: string): KeyValueStore {
    let store = stores.get(storeId);
    if (!store) {
        store = new KeyValueStore(storeId, persistence, storeOptions);
        stores.set(storeId, store);
        // 立即开始 hydrate。同步读在 hydrate 完成前返回 undefined，因此
        // bootstrap 必须先 await hydrateKeyValueStores() 再读配置。
        void store.hydrate();
    }
    return store;
}

/**
 * 确保单个 store 已从磁盘载入。
 *
 * 动态 store（LocalSheet.<id>、MediaExtra.<plugin>）不在启动预载列表里，
 * 首次同步读取之前必须调用这个，否则会读到空表。
 */
export async function hydrateKeyValueStore(storeId: string) {
    await getKeyValueStore(storeId).hydrate();
}

/** 等待已创建的 store 全部从磁盘载入。 */
export async function hydrateKeyValueStores() {
    await Promise.all([...stores.values()].map(store => store.hydrate()));
}

/** 退出前把所有待写变更落盘。返回是否全部写成功。 */
export async function flushKeyValueStores(): Promise<boolean> {
    const results = await Promise.all(
        [...stores.values()].map(store => store.flush()),
    );
    return results.every(Boolean);
}

export function listKeyValueStoreIds() {
    return [...stores.keys()];
}
