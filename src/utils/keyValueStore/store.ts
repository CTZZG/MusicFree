import { MIGRATION_FLAG_KEY } from "./mmkvMigration";
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
 *
 * hydrate 完成之前的写入（set / delete / clearAll / updateString）先作用在内存，
 * 同时记下来，读盘完成后按顺序重放到磁盘内容上：等价于它们发生在读盘之后。
 * 以前是「整个键以内存为准」，于是读盘前的局部更新会盖掉磁盘上同一个键的其他
 * 字段，读盘前的删除也会被磁盘上的旧值复活。落盘同样要等读盘完成，否则会把只有
 * 这几个早到的键的快照写下去，覆盖掉整份文件。
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
    /** 读盘完成前的写入，读盘后按顺序重放；读盘后为 null。 */
    private pendingOps: Array<() => void> | null = [];
    /** 正在进行的落盘；flush 要等它，再把之后的变更写出去。 */
    private inflight: Promise<boolean> | null = null;

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
            let base: Record<string, StoredValue> = {};
            try {
                const raw = await this.persistence.read(this.storeId);
                const decoded = decodeSnapshot(raw);
                if (decoded.recovered) {
                    this.options.onRecover?.({
                        storeId: this.storeId,
                        reason: decoded.reason,
                    });
                }
                base = decoded.entries;
            } catch (error) {
                // 读不到就当空表起步，并上报。抛出会让应用起不来。
                this.options.onRecover?.({
                    storeId: this.storeId,
                    reason: `read-failed:${String(
                        (error as any)?.message ?? error,
                    )}`,
                });
            } finally {
                // 读盘之前（以及读盘期间）的写入是更新的：按发生顺序重放到磁盘
                // 内容上，而不是整个键以内存为准。
                const ops = this.pendingOps ?? [];
                this.pendingOps = null;
                this.entries = { ...base };
                ops.forEach(op => op());
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
        const apply = () => {
            this.entries[key] = stored;
        };
        apply();
        this.recordBeforeHydrate(apply);
        this.markDirty();
        this.notify(key);
    }

    /**
     * 读出当前字符串、算出新值再写回（返回 undefined 表示删除）。
     *
     * 局部更新（例如只改一首歌的歌词偏移）要用它而不是先 get 再 set：读盘完成
     * 之前 get 拿不到磁盘上的值，set 回去的局部对象会盖掉其他字段。这里在读盘
     * 完成后会用磁盘上的值再算一遍，所以 updater 必须是纯函数。
     */
    updateString(
        key: string,
        updater: (current: string | undefined) => string | undefined,
    ) {
        const apply = () => {
            const next = updater(this.getString(key));
            if (next === undefined) {
                delete this.entries[key];
            } else {
                this.entries[key] = { t: "s", v: next };
            }
        };
        const before = this.entries[key];
        apply();
        this.recordBeforeHydrate(apply);
        const after = this.entries[key];
        const changed =
            before?.t !== after?.t || before?.v !== after?.v;
        if (changed || !this.hydrated) {
            this.markDirty();
        }
        if (changed) {
            this.notify(key);
        }
    }

    delete(key: string) {
        if (!this.hydrated) {
            // 磁盘上可能有这个键，内存里还没有：删除也要记下来，读盘后重放，
            // 否则旧值会被读盘复活。
            const existed = key in this.entries;
            const apply = () => {
                delete this.entries[key];
            };
            apply();
            this.recordBeforeHydrate(apply);
            this.markDirty();
            if (existed) {
                this.notify(key);
            }
            return;
        }
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
        // 迁移标记是存储自己的元数据，不是用户数据：清掉它，下次启动会再从旧
        // MMKV 迁移一遍，把刚清空的旧数据又搬回来。
        const keys = Object.keys(this.entries).filter(
            key => key !== MIGRATION_FLAG_KEY,
        );
        if (!keys.length && this.hydrated) {
            return;
        }
        const apply = () => {
            const flag = this.entries[MIGRATION_FLAG_KEY];
            this.entries = flag ? { [MIGRATION_FLAG_KEY]: flag } : {};
        };
        apply();
        this.recordBeforeHydrate(apply);
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

    /**
     * 立刻落盘并等待完成，返回调用之前的变更是否都已写到磁盘。
     *
     * 正在进行的那次写入用的是它开始时的快照，可能早于调用前的修改，所以要先
     * 等它写完，再把剩下的变更写出去；以前遇到正在写就直接返回，最新的修改只
     * 留在内存里。写失败返回 false（之后仍按退避重试），不抛出。
     */
    async flush(): Promise<boolean> {
        this.cancelTimer();
        while (this.writing && this.inflight) {
            await this.inflight;
        }
        if (!this.dirty) {
            return true;
        }
        this.cancelTimer();
        return this.performWrite();
    }

    private recordBeforeHydrate(op: () => void) {
        if (!this.hydrated) {
            this.pendingOps?.push(op);
        }
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

    private performWrite(): Promise<boolean> {
        if (this.writing && this.inflight) {
            return this.inflight;
        }
        this.writing = true;
        const run = this.writeOnce();
        this.inflight = run;
        return run;
    }

    private async writeOnce(): Promise<boolean> {
        // 读盘完成前不能落盘：那时内存里只有早到的几个键，写下去会覆盖整份文件。
        if (!this.hydrated) {
            await this.hydrate();
        }
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
        // performWrite 会直接拿到这一轮（已结束）的结果，重试链就断在这里，
        // 数据永远留在内存。
        this.writing = false;
        this.inflight = null;

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
                return false;
            }
            this.retryAttempt += 1;
            this.armRetryTimer(delayMs);
            return false;
        }

        // 写入成功。若期间又产生了变更（快照是写入前取的，这些新值还没落盘），
        // 立刻重新评估——这里不能加 `timerHandle === null` 条件，那会在恰好
        // 有定时器挂着时把新变更漏掉。
        if (this.dirty) {
            this.schedule();
        }
        return true;
    }
}
