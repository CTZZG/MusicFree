import CrossfadeController from "../crossfadeController";
import { RESTORE_RAMP_MS } from "../crossfadePolicy";

/**
 * 用受控时钟 + 受控定时器驱动，避免测试依赖真实 50ms 心跳。
 * setTimer 只登记回调，由 `pump()` 按固定步长手动推进。
 */
function createHarness(settings: { enabled: boolean; seconds: number }) {
    const applied: number[] = [];
    let currentSettings = settings;
    let now = 0;
    let tickHandler: (() => void) | null = null;
    let intervalMs = 0;

    const controller = new CrossfadeController({
        applyGain: gain => applied.push(gain),
        readSettings: () => currentSettings,
        now: () => now,
        setTimer: (handler, ms) => {
            tickHandler = handler;
            intervalMs = ms;
            return 1;
        },
        clearTimer: () => {
            tickHandler = null;
        },
    });

    return {
        controller,
        applied,
        get gain() {
            return controller.getGain();
        },
        get running() {
            return tickHandler !== null;
        },
        setSettings(next: { enabled: boolean; seconds: number }) {
            currentSettings = next;
        },
        /** 推进 totalMs 毫秒，按定时器步长逐拍触发。 */
        pump(totalMs: number) {
            const step = intervalMs || 50;
            let remaining = totalMs;
            while (remaining > 0 && tickHandler) {
                const delta = Math.min(step, remaining);
                now += delta;
                remaining -= delta;
                tickHandler();
            }
            // 定时器停了也要让时钟继续走，模拟真实时间流逝
            now += Math.max(0, remaining);
        },
    };
}

describe("CrossfadeController", () => {
    it("关闭时进度推进完全不碰音量", () => {
        const h = createHarness({ enabled: false, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(5000);
        expect(h.applied).toHaveLength(0);
        expect(h.gain).toBe(1);
    });

    it("进入淡出区后音量降到 0", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        expect(h.running).toBe(true);
        h.pump(4000);
        expect(h.gain).toBeCloseTo(0, 2);
        expect(h.running).toBe(false);
    });

    it("淡出中途音量单调下降，不是一步到底", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(1000);
        const quarter = h.gain;
        h.pump(1000);
        const half = h.gain;
        expect(quarter).toBeLessThan(1);
        expect(quarter).toBeGreaterThan(0);
        expect(half).toBeLessThan(quarter);
        expect(h.applied.length).toBeGreaterThan(5);
    });

    it("自然结束后的下一首用完整时长淡入到 1", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(4000);
        expect(h.gain).toBeCloseTo(0, 2);

        h.controller.onTrackStarted();
        h.pump(5000);
        expect(h.gain).toBeCloseTo(1, 2);
    });

    it("手动切歌（没经历淡出，音量本就是 1）不做任何淡入", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onTrackStarted();
        expect(h.running).toBe(false);
        expect(h.gain).toBe(1);
        expect(h.applied).toHaveLength(0);
    });

    it("淡出跑到一半就切歌时用短坡道快速恢复，不拖几秒才出声", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(2000);
        const midGain = h.gain;
        expect(midGain).toBeGreaterThan(0);
        expect(midGain).toBeLessThan(1);

        h.controller.onTrackStarted();
        h.pump(RESTORE_RAMP_MS);
        expect(h.gain).toBeCloseTo(1, 2);
    });

    it("往回拖出淡出区会把音量收回 1", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 197, duration: 200 });
        h.pump(1500);
        expect(h.gain).toBeLessThan(1);

        h.controller.onSeeked({ position: 20, duration: 200 });
        h.pump(RESTORE_RAMP_MS);
        expect(h.gain).toBeCloseTo(1, 2);
    });

    it("暂停时坡道冻结，恢复后从原处继续", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(1000);
        const beforePause = h.gain;

        h.controller.onPause();
        expect(h.running).toBe(false);
        h.pump(10000);
        expect(h.gain).toBe(beforePause);

        h.controller.onPlay();
        expect(h.running).toBe(true);
        h.pump(3000);
        expect(h.gain).toBeCloseTo(0, 2);
    });

    it("播放中途关掉设置会把已经压下去的音量平滑收回", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(2000);
        expect(h.gain).toBeLessThan(1);

        h.setSettings({ enabled: false, seconds: 5 });
        h.controller.refreshSettings();
        h.pump(RESTORE_RAMP_MS);
        expect(h.gain).toBeCloseTo(1, 2);
    });

    it("reset 立即归位并停掉定时器", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(2000);

        h.controller.reset();
        expect(h.gain).toBe(1);
        expect(h.running).toBe(false);
        expect(h.applied[h.applied.length - 1]).toBe(1);
    });

    it("同一次淡出不会被后续进度事件重复触发", () => {
        const h = createHarness({ enabled: true, seconds: 5 });
        h.controller.onProgress({ position: 196, duration: 200 });
        h.pump(500);
        const afterFirst = h.gain;
        h.controller.onProgress({ position: 196.5, duration: 200 });
        h.pump(500);
        // 坡道没有被重置回起点
        expect(h.gain).toBeLessThan(afterFirst);
    });
});
