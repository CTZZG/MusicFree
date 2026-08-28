import KeyValueStore from "../store";
import { decodeSnapshot, encodeSnapshot } from "../snapshotCodec";
import type { IStorePersistence } from "../types";

/** 可控时钟 + 手动跑定时器，让落盘时序完全确定。 */
function createHarness() {
    let now = 0;
    const timers: { id: number; at: number; fn: () => void }[] = [];
    let nextId = 1;
    const files = new Map<string, string>();
    const writes: string[] = [];
    let failNextWrites = 0;
    let writeError = new Error("disk full");

    const persistence: IStorePersistence = {
        async read(id) {
            return files.has(id) ? files.get(id)! : null;
        },
        async write(id, contents) {
            writes.push(id);
            if (failNextWrites > 0) {
                failNextWrites -= 1;
                throw writeError;
            }
            files.set(id, contents);
        },
        async remove(id) {
            files.delete(id);
        },
    };

    return {
        persistence,
        files,
        writes,
        get now() {
            return now;
        },
        failWrites(count: number, error?: Error) {
            failNextWrites = count;
            if (error) {
                writeError = error;
            }
        },
        options: {
            now: () => now,
            setTimer: (fn: () => void, delayMs: number) => {
                const id = nextId++;
                timers.push({ id, at: now + delayMs, fn });
                return id;
            },
            clearTimer: (id: any) => {
                const idx = timers.findIndex(t => t.id === id);
                if (idx >= 0) {
                    timers.splice(idx, 1);
                }
            },
        },
        /**
         * 推进时间并执行到期定时器。
         *
         * 每轮之后要让出足够多的微任务：落盘是 async，一次 `await` 只推进
         * 一个 then，而 performWrite 内部有多层（write → 判定 → 重排定时器）。
         * 让出不够会看到「重试链没跑」的假失败。
         */
        async advance(ms: number) {
            now += ms;
            for (let guard = 0; guard < 200; guard++) {
                const due = timers.filter(t => t.at <= now);
                if (!due.length) {
                    break;
                }
                for (const t of due) {
                    const idx = timers.indexOf(t);
                    if (idx >= 0) {
                        timers.splice(idx, 1);
                    }
                    t.fn();
                }
                for (let i = 0; i < 20; i++) {
                    await Promise.resolve();
                }
            }
            for (let i = 0; i < 20; i++) {
                await Promise.resolve();
            }
        },
    };
}

describe("KeyValueStore", () => {
    it("reads and writes synchronously in memory", () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);

        store.set("text", "hello");
        store.set("num", 7);
        store.set("flag", true);

        // 关键：不需要 await 就能读到，这是既有调用点依赖的语义。
        expect(store.getString("text")).toBe("hello");
        expect(store.getNumber("num")).toBe(7);
        expect(store.getBoolean("flag")).toBe(true);
        expect(store.size).toBe(3);
        expect(store.getAllKeys().sort()).toEqual(["flag", "num", "text"]);
    });

    it("does not coerce across types, matching MMKV", () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        store.set("n", 1);
        expect(store.getString("n")).toBeUndefined();
        expect(store.getBoolean("n")).toBeUndefined();
        expect(store.getNumber("n")).toBe(1);
    });

    it("persists to disk after the quiet period", async () => {
        const h = createHarness();
        const store = new KeyValueStore("cfg", h.persistence, h.options);
        store.set("a", "1");
        expect(h.files.has("cfg")).toBe(false);

        await h.advance(200);

        expect(h.files.has("cfg")).toBe(true);
        expect(decodeSnapshot(h.files.get("cfg")!).entries).toEqual({
            a: { t: "s", v: "1" },
        });
    });

    it("coalesces a burst of writes into one flush", async () => {
        const h = createHarness();
        const store = new KeyValueStore("cfg", h.persistence, h.options);
        for (let i = 0; i < 20; i++) {
            store.set(`k${i}`, i);
        }
        await h.advance(200);
        expect(h.writes).toEqual(["cfg"]);
        expect(store.size).toBe(20);
    });

    // 回归护栏：持续写入（播放进度就是这样）不能让 debounce 永远不到期。
    it("still flushes under a continuous stream of writes", async () => {
        const h = createHarness();
        const store = new KeyValueStore("prog", h.persistence, h.options);
        for (let i = 0; i < 40; i++) {
            store.set("position", i);
            await h.advance(50); // 每次都比 debounce(120) 短
        }
        expect(h.writes.length).toBeGreaterThan(0);
        expect(h.files.has("prog")).toBe(true);
    });

    it("hydrates existing data from disk", async () => {
        const h = createHarness();
        h.files.set("cfg", encodeSnapshot({ saved: { t: "s", v: "yes" } }));

        const store = new KeyValueStore("cfg", h.persistence, h.options);
        expect(store.getString("saved")).toBeUndefined();
        await store.hydrate();
        expect(store.getString("saved")).toBe("yes");
        expect(store.isHydrated).toBe(true);
    });

    // 竞态：hydrate 尚未完成时发生的写入更新，不能被旧快照覆盖。
    it("lets pre-hydrate writes win over stale disk data", async () => {
        const h = createHarness();
        h.files.set("cfg", encodeSnapshot({ k: { t: "s", v: "old" } }));
        const store = new KeyValueStore("cfg", h.persistence, h.options);

        store.set("k", "new");
        await store.hydrate();

        expect(store.getString("k")).toBe("new");
    });

    it("degrades to an empty store and reports corruption", async () => {
        const h = createHarness();
        h.files.set("cfg", "{ this is not json");
        const recovers: any[] = [];
        const store = new KeyValueStore("cfg", h.persistence, {
            ...h.options,
            onRecover: info => recovers.push(info),
        });

        await store.hydrate();

        expect(store.size).toBe(0);
        expect(recovers).toEqual([
            { storeId: "cfg", reason: "invalid-json" },
        ]);
    });

    it("retries a failed write and keeps the data", async () => {
        const h = createHarness();
        const store = new KeyValueStore("cfg", h.persistence, h.options);
        h.failWrites(1);

        store.set("a", "1");
        await h.advance(200);
        expect(h.files.has("cfg")).toBe(false); // 第一次失败

        await h.advance(300); // 退避 200ms 后重试
        expect(h.files.has("cfg")).toBe(true);
        expect(store.getString("a")).toBe("1");
    });

    // 静默丢数据是旧方案最难查的问题，所以彻底失败必须上报。
    it("reports persist failure after exhausting retries", async () => {
        const h = createHarness();
        const errors: any[] = [];
        const store = new KeyValueStore("cfg", h.persistence, {
            ...h.options,
            retryDelaysMs: [10, 20],
            onPersistError: info => errors.push(info),
        });
        h.failWrites(99);

        store.set("a", "1");
        // 分步推进：一次跳到 1000ms 会让 debounce 与两级退避挤在同一轮，
        // 掩盖中间状态。这里按实际时序走，确保每次重试都真的被触发。
        await h.advance(150);
        await h.advance(20);
        await h.advance(30);

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].storeId).toBe("cfg");
    });

    // 关键不变量：落盘的快照是写入开始那一刻取的，写入期间到来的新值
    // 必须在这一轮成功之后再落一次，不能被「写成功」掩盖掉。
    //
    // 这里用真实定时器 + 真实微任务，而不是可控时钟：这个场景要验证的是
    // promise 与定时器交错下的行为，用假时钟精确编排交错点反而比被测逻辑
    // 更容易写错（此前就因此得到过假失败）。
    it("keeps changes made during an in-flight write", async () => {
        const files = new Map<string, string>();
        const writeCalls: string[] = [];
        // 用容器对象持有回调：TS 的控制流分析看不到异步回调里的赋值，
        // 直接用 let 会被收窄成 never。
        const gate: { release?: () => void } = {};
        const entered: { signal?: () => void } = {};
        const enteredFirstWrite = new Promise<void>(resolve => {
            entered.signal = resolve;
        });

        const slow: IStorePersistence = {
            async read() {
                return null;
            },
            async write(id, contents) {
                writeCalls.push(contents);
                // 只把第一次写入挂起，后续写入直接完成。
                if (writeCalls.length === 1) {
                    await new Promise<void>(resolve => {
                        gate.release = resolve;
                        entered.signal?.();
                    });
                }
                files.set(id, contents);
            },
            async remove() {
                // 未使用
            },
        };
        const store = new KeyValueStore("cfg", slow, { debounceMs: 1 });

        store.set("first", "1");
        await enteredFirstWrite;   // 第一轮写入已挂在 gate 上
        store.set("second", "2");  // 挂起期间产生新值
        gate.release?.();          // 放行第一轮

        // 等第二轮落盘：内容里出现 second 即完成。
        for (let i = 0; i < 100; i++) {
            if (files.get("cfg")?.includes("second")) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        expect(writeCalls.length).toBeGreaterThanOrEqual(2);
        const persisted = decodeSnapshot(files.get("cfg")!).entries;
        expect(persisted.first).toEqual({ t: "s", v: "1" });
        expect(persisted.second).toEqual({ t: "s", v: "2" });
    });

    it("notifies listeners only when the value actually changes", () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        const seen: string[] = [];
        const sub = store.addOnValueChangedListener(key => seen.push(key));

        store.set("a", "1");
        store.set("a", "1"); // 同值，不应通知
        store.set("a", "2");
        store.delete("a");
        store.delete("a"); // 已不存在，不应通知

        expect(seen).toEqual(["a", "a", "a"]);
        sub.remove();
        store.set("a", "3");
        expect(seen).toHaveLength(3);
    });

    it("survives a throwing listener", () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        const seen: string[] = [];
        store.addOnValueChangedListener(() => {
            throw new Error("boom");
        });
        store.addOnValueChangedListener(key => seen.push(key));

        expect(() => store.set("a", "1")).not.toThrow();
        expect(seen).toEqual(["a"]);
    });

    it("clears everything and notifies each key", async () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        store.set("a", "1");
        store.set("b", "2");
        const seen: string[] = [];
        store.addOnValueChangedListener(key => seen.push(key));

        store.clearAll();

        expect(store.size).toBe(0);
        expect(seen.sort()).toEqual(["a", "b"]);
        await h.advance(200);
        expect(decodeSnapshot(h.files.get("s")!).entries).toEqual({});
    });

    it("flushes on demand for shutdown paths", async () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        store.set("a", "1");
        await store.flush();
        expect(h.files.has("s")).toBe(true);
    });

    it("ignores values that cannot round-trip", () => {
        const h = createHarness();
        const store = new KeyValueStore("s", h.persistence, h.options);
        store.set("bad", Number.NaN);
        expect(store.contains("bad")).toBe(false);
    });
});
