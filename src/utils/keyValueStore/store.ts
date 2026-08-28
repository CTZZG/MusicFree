import { decodeSnapshot, encodeSnapshot, toStoredValue } from "./snapshotCodec";
import {
    DEFAULT_RETRY_DELAYS_MS,
    resolveRetryDelayMs,
    resolveWriteDecision,
    type IWriteSchedulerOptions,
} from "./writeScheduler";
import type {
    IKeyValueStore,
    IStorePersistence,
    StoredValue,
} from "./types";

export interface IKeyValueStoreOptions extends IWriteSchedulerOptions {
    now?: () => number;
    setTimer?: (handler: () => void, delayMs: number) => any;
    clearTimer?: (handle: any) => void;
    /** 落盘彻底失败时上报。存储层不该 throw，但失败必须可观察。 */
    onPersistError?: (info: {
        storeId: string;
        attempts: number;
        error: unknown;
    }) => void;
    /** 读取时发现快照损坏并降级时上报。 */
    onRecover?: (info: { storeId: string; reason?: string }) => void;
}

/**
 * 文件支撑的键值存储。
 *
 * 读写全部同步命中内存，落盘异步合并——这套语义与 react-native-mmkv 的常用
 * 子集一致，因此十几个既有调用点无需改写。与 MMKV 的关键区别在落盘：写到
 * 应用内部存储、整份 JSON、临时文件加 rename 原子替换，且失败会上报。
 *
 * 必须先 `await hydrate()` 才能读到磁盘上的既有数据。这是这套方案唯一比
 * MMKV 多出的约束（MMKV 构造即同步 mmap 完成），所以 bootstrap 里要在读取
 * 任何配置之前完成 hydrate。
 */
export default class KeyValueStore implements IKeyValueStore {
    private entries: Record<string, StoredValue> = {};
    private listeners = new Set<(key: string) => void>();

    private dirty = false;
    private writing = false;
    private firstDirtyAt: number | null = null;
    private lastDirtyAt: number | null = null;
    private timerHandle: any = null;
    private retryAttempt = 0;
    private hydrated = false;
    private hydratePromise: Promise<void> | null = null;

    private readonly now: () => number;
    private readonly setTimer: (handler: () => void, delayMs: number) => any;
    private readonly clearTimer: (handle: any) => void;

    constructor(
        readonly storeId: string,
        private readonly persistence: IStorePersistence,
        private readonly options: IKeyValueStoreOptions = {},
    ) {
        this.now = options.now ?? (() => Date.now());
        this.setTimer =
            options.setTimer ??
            ((handler, delayMs) => setTimeout(handler, delayMs));
        this.clearTimer =
            options.clearTimer ?? ((handle: any) => clearTimeout(handle));
    }

    get isHydrated() {
        return this.hydrated;
    }

    /** 从磁盘载入。重复调用共享同一个 promise，多次调用是安全的。 */
    hydrate(): Promise<void> {
        this.hydratePromise ??= (async () => {
            try {
                const raw = await this.persistence.read(this.storeId);
                const decoded = decodeSnapshot(raw);
                if (decoded.recovered) {
                    this.options.onRecover?.({
                        storeId: this.storeId,
                        reason: decoded.reason,
                    });
                }
                // 已经通过 set 写入内存的值优先于磁盘：hydrate 之前发生的写入
                // 是更新的，不能被旧快照覆盖。
                this.entries = { ...decoded.entries, ...this.entries };
            } catch (error) {
                // 读不到就当空表起步，并上报。抛出会让应用起不来。
                this.options.onRecover?.({
                    storeId: this.storeId,
                    reason: `read-failed:${String(
                        (error as any)?.message ?? error,
                    )}`,
                });
            } finally {
                this.hydrated = true;
            }
        })();
        return this.hydratePromise;
    }

    getString(key: string) {
        const entry = this.entries[key];
        if (!entry) {
            return undefined;
        }
        // 与 MMKV 一致：类型不符时返回 undefined 而不是强转，避免调用方
        // 拿到 "true" 这种意外字符串。
        return entry.t === "s" ? entry.v : undefined;
    }

    getNumber(key: string) {
        const entry = this.entries[key];
        return entry?.t === "n" ? entry.v : undefined;
    }

    getBoolean(key: string) {
        const entry = this.entries[key];
        return entry?.t === "b" ? entry.v : undefined;
    }

    set(key: string, value: string | number | boolean) {
        const stored = toStoredValue(value);
        if (!stored) {
            return;
        }
        const previous = this.entries[key];
        if (previous && previous.t === stored.t && previous.v === stored.v) {
            // 值没变就不落盘也不通知，避免热路径（播放进度）产生无谓的写与重渲染。
            return;
        }
        this.entries[key] = stored;
        this.markDirty();
        this.notify(key);
    }

    delete(key: string) {
        if (!(key in this.entries)) {
            return;
        }
        delete this.entries[key];
        this.markDirty();
        this.notify(key);
    }

    remove(key: string) {
        this.delete(key);
    }

    contains(key: string) {
        return key in this.entries;
    }

    getAllKeys() {
        return Object.keys(this.entries);
    }

    clearAll() {
        const keys = Object.keys(this.entries);
        if (!keys.length) {
            return;
        }
        this.entries = {};
        this.markDirty();
        keys.forEach(key => this.notify(key));
    }

    /**
     * 已存储的键数量。
     *
     * 注意语义差异：MMKV 的 size 是字节数。项目里的 15 处调用全部只用它做
     * 「是否为空 / 有多少条」的判断，所以键数是等价且更直观的。
     */
    get size() {
        return Object.keys(this.entries).length;
    }

    /** MMKV 的碎片整理。整份 JSON 落盘没有碎片，空操作。 */
    trim() {
        // no-op
    }

    addOnValueChangedListener(listener: (key: string) => void) {
        this.listeners.add(listener);
        return {
            remove: () => {
                this.listeners.delete(listener);
            },
        };
    }

    /** 立刻落盘并等待完成。用于应用退出前确保不丢数据。 */
    async flush(): Promise<void> {
        this.cancelTimer();
        if (!this.dirty || this.writing) {
            return;
        }
        await this.performWrite();
    }

    private notify(key: string) {
        this.listeners.forEach(listener => {
            try {
                listener(key);
            } catch {
                // 单个订阅者出错不能影响存储本身与其他订阅者。
            }
        });
    }

    private markDirty() {
        const now = this.now();
        this.dirty = true;
        this.firstDirtyAt ??= now;
        this.lastDirtyAt = now;
        this.retryAttempt = 0;
        this.schedule();
    }

    private schedule() {
        const now = this.now();
        const decision = resolveWriteDecision({
            dirty: this.dirty,
            writing: this.writing,
            ageMs: this.firstDirtyAt === null ? null : now - this.firstDirtyAt,
            idleMs: this.lastDirtyAt === null ? null : now - this.lastDirtyAt,
            options: this.options,
        });

        if (decision.action === "idle") {
            this.cancelTimer();
            return;
        }
        if (decision.action === "flush") {
            this.cancelTimer();
            void this.performWrite();
            return;
        }
        this.armTimer(decision.delayMs);
    }

    private armTimer(delayMs: number) {
        this.cancelTimer();
        this.timerHandle = this.setTimer(() => {
            this.timerHandle = null;
            this.schedule();
        }, delayMs);
    }

    /**
     * 重试专用定时器：到期后**直接**落盘，不再走 schedule()。
     *
     * 走 schedule() 会因为「距上次变更不足 debounce」而判定为继续等待，
     * 于是重试链在第一次退避后就断了，数据留在内存里再也不会写盘。
     */
    private armRetryTimer(delayMs: number) {
        this.cancelTimer();
        this.timerHandle = this.setTimer(() => {
            this.timerHandle = null;
            void this.performWrite();
        }, delayMs);
    }

    private cancelTimer() {
        if (this.timerHandle !== null) {
            this.clearTimer(this.timerHandle);
            this.timerHandle = null;
        }
    }

    private async performWrite(): Promise<void> {
        if (this.writing) {
            return;
        }
        this.writing = true;
        // 先取快照再清脏标记：写入期间到来的新变更会重新置脏，写完后再落一次，
        // 不会被这一轮的成功掩盖掉。
        const payload = encodeSnapshot({ ...this.entries });
        this.dirty = false;
        this.firstDirtyAt = null;
        this.lastDirtyAt = null;

        let failure: unknown = null;
        let failed = false;
        try {
            await this.persistence.write(this.storeId, payload);
            this.retryAttempt = 0;
        } catch (error) {
            failed = true;
            failure = error;
        }
        // writing 必须在任何重排之前落回 false，否则重试定时器触发的
        // performWrite 会被开头的 `if (this.writing) return` 直接吞掉，
        // 重试链就断在这里，数据永远留在内存。
        this.writing = false;

        if (failed) {
            const delayMs = resolveRetryDelayMs(
                this.retryAttempt,
                this.options,
            );
            // 把脏标记恢复，让内容有机会在重试或后续写入中落盘。
            this.dirty = true;
            const now = this.now();
            this.firstDirtyAt ??= now;
            this.lastDirtyAt = now;

            if (delayMs === null) {
                const attempts = (
                    this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
                ).length;
                this.retryAttempt = 0;
                this.options.onPersistError?.({
                    storeId: this.storeId,
                    attempts,
                    error: failure,
                });
                // 已上报并放弃这一轮；等下一次 set 再触发，避免无限重试。
                return;
            }
            this.retryAttempt += 1;
            this.armRetryTimer(delayMs);
            return;
        }

        // 写入成功。若期间又产生了变更（快照是写入前取的，这些新值还没落盘），
        // 立刻重新评估——这里不能加 `timerHandle === null` 条件，那会在恰好
        // 有定时器挂着时把新变更漏掉。
        if (this.dirty) {
            this.schedule();
        }
    }
}
