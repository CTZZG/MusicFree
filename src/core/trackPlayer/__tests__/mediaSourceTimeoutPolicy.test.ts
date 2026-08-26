import {
    MediaSourceTimeoutError,
    isStaleManualSkipIntent,
    manualSkipIntentTtlMs,
    withMediaSourceTimeout,
} from "../mediaSourceTimeoutPolicy";

describe("withMediaSourceTimeout", () => {
    it("resolves when the task finishes in time", async () => {
        await expect(
            withMediaSourceTimeout(Promise.resolve("url"), { timeoutMs: 50 }),
        ).resolves.toBe("url");
    });

    it("propagates the task's own rejection unchanged", async () => {
        const failure = new Error("plugin exploded");
        await expect(
            withMediaSourceTimeout(Promise.reject(failure), { timeoutMs: 50 }),
        ).rejects.toBe(failure);
    });

    it("rejects with a timeout error when the task never settles", async () => {
        // 永不 settle 的插件 Promise：这正是真机上卡住整条切歌队列的形态
        const pending = new Promise<string>(() => undefined);
        await expect(
            withMediaSourceTimeout(pending, { timeoutMs: 10 }),
        ).rejects.toBeInstanceOf(MediaSourceTimeoutError);
    });

    it("ignores a late result that arrives after the timeout", async () => {
        const deferred: { resolve?: (value: string) => void } = {};
        const late = new Promise<string>(resolve => {
            deferred.resolve = resolve;
        });
        const guarded = withMediaSourceTimeout(late, { timeoutMs: 10 });
        await expect(guarded).rejects.toBeInstanceOf(MediaSourceTimeoutError);
        // 迟到的结果不得把已经 reject 的 Promise 再翻回 resolve
        deferred.resolve?.("late-url");
        await expect(guarded).rejects.toBeInstanceOf(MediaSourceTimeoutError);
    });

    it("passes the task through when the timeout is disabled", async () => {
        await expect(
            withMediaSourceTimeout(Promise.resolve("url"), { timeoutMs: 0 }),
        ).resolves.toBe("url");
    });
});

describe("isStaleManualSkipIntent", () => {
    const now = 1_000_000;

    it("drops an intent that waited longer than the ttl in the queue", () => {
        expect(
            isStaleManualSkipIntent({
                enqueuedAt: now - manualSkipIntentTtlMs - 1,
                now,
            }),
        ).toBe(true);
    });

    it("keeps an intent that is still fresh", () => {
        expect(
            isStaleManualSkipIntent({ enqueuedAt: now - 200, now }),
        ).toBe(false);
        expect(
            isStaleManualSkipIntent({
                enqueuedAt: now - manualSkipIntentTtlMs,
                now,
            }),
        ).toBe(false);
    });

    it("keeps intents without a usable timestamp (in-app buttons)", () => {
        expect(isStaleManualSkipIntent({ now })).toBe(false);
        expect(
            isStaleManualSkipIntent({ enqueuedAt: Number.NaN, now }),
        ).toBe(false);
        // 时钟回拨不算过期
        expect(
            isStaleManualSkipIntent({ enqueuedAt: now + 5000, now }),
        ).toBe(false);
    });
});
