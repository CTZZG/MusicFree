import {
    DEFAULT_DEBOUNCE_MS,
    DEFAULT_MAX_DELAY_MS,
    resolveRetryDelayMs,
    resolveWriteDecision,
} from "../writeScheduler";

const clean = { dirty: false, writing: false, ageMs: null, idleMs: null };

describe("write scheduler policy", () => {
    it("does nothing when there is nothing to persist", () => {
        expect(resolveWriteDecision(clean)).toEqual({ action: "idle" });
    });

    it("never starts a second write while one is in flight", () => {
        // 并发写同一份文件会产生半份内容，这是不可接受的。
        expect(resolveWriteDecision({
            dirty: true,
            writing: true,
            ageMs: 10_000,
            idleMs: 10_000,
        })).toEqual({ action: "idle" });
    });

    it("waits out the quiet period before flushing", () => {
        const decision = resolveWriteDecision({
            dirty: true,
            writing: false,
            ageMs: 20,
            idleMs: 20,
        });
        expect(decision).toEqual({
            action: "wait",
            delayMs: DEFAULT_DEBOUNCE_MS - 20,
        });
    });

    it("flushes once the store has been quiet long enough", () => {
        expect(resolveWriteDecision({
            dirty: true,
            writing: false,
            ageMs: DEFAULT_DEBOUNCE_MS,
            idleMs: DEFAULT_DEBOUNCE_MS,
        })).toEqual({ action: "flush" });
    });

    // 关键不变量：持续不断的写入（播放进度就是这样）不能让 debounce 永远
    // 不到期，否则进程被杀时全部变更一起丢。
    it("forces a flush at the hard ceiling even under constant writes", () => {
        expect(resolveWriteDecision({
            dirty: true,
            writing: false,
            ageMs: DEFAULT_MAX_DELAY_MS,
            idleMs: 0,
        })).toEqual({ action: "flush" });
    });

    it("never waits past the hard ceiling", () => {
        const decision = resolveWriteDecision({
            dirty: true,
            writing: false,
            ageMs: DEFAULT_MAX_DELAY_MS - 30,
            idleMs: 0,
        });
        expect(decision).toEqual({ action: "wait", delayMs: 30 });
    });

    it("always waits at least a tick so it cannot spin", () => {
        const decision = resolveWriteDecision({
            dirty: true,
            writing: false,
            ageMs: DEFAULT_MAX_DELAY_MS - 1,
            idleMs: DEFAULT_DEBOUNCE_MS - 1,
        });
        expect(decision).toEqual({ action: "wait", delayMs: 1 });
    });

    it("backs off across retries and then gives up", () => {
        expect(resolveRetryDelayMs(0)).toBe(200);
        expect(resolveRetryDelayMs(1)).toBe(1_000);
        expect(resolveRetryDelayMs(2)).toBe(5_000);
        // 用尽后返回 null，调用方据此上报失败而不是无限重试。
        expect(resolveRetryDelayMs(3)).toBeNull();
        expect(resolveRetryDelayMs(-1)).toBeNull();
    });

    it("honours custom timings", () => {
        const options = { debounceMs: 10, maxDelayMs: 50 };
        expect(resolveWriteDecision({
            dirty: true, writing: false, ageMs: 10, idleMs: 10, options,
        })).toEqual({ action: "flush" });
        expect(resolveRetryDelayMs(0, { retryDelaysMs: [7] })).toBe(7);
    });
});
