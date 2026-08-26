import {
    clampCrossfadeSeconds,
    fadeInGain,
    fadeOutGain,
    linearGain,
    resolveFadeOutDurationMs,
    RESTORE_RAMP_MS,
    shouldCancelFadeOut,
} from "./crossfadePolicy";

/** 音量坡道每 50ms 推进一次；20fps 对音量渐变来说已经听不出台阶。 */
const TICK_MS = 50;

/** 增益变化小于这个量就不下发，省掉大量无意义的跨端调用。 */
const GAIN_EPSILON = 0.005;

type RampKind = "in" | "out" | "restore";

interface ActiveRamp {
    kind: RampKind;
    durationMs: number;
    elapsedMs: number;
    /** 仅 restore 坡道使用：起点增益 */
    fromGain: number;
}

export interface CrossfadeSettings {
    enabled: boolean;
    seconds: number;
}

export interface CrossfadeProgress {
    position: number;
    duration: number;
}

export interface CrossfadeControllerOptions {
    /** 下发增益（0-1）。实现方负责真正调播放器音量。 */
    applyGain: (gain: number) => void;
    /** 每次需要最新设置时调用；返回 null 视为关闭。 */
    readSettings: () => CrossfadeSettings | null;
    now?: () => number;
    setTimer?: (handler: () => void, intervalMs: number) => any;
    clearTimer?: (handle: any) => void;
}

/**
 * 淡入淡出的执行器：把「策略算出来的增益」按真实时钟推进并下发给播放器。
 *
 * 设计上刻意不依赖进度事件的粒度——进度事件大约每秒才来一次，直接拿它当
 * 坡道时钟会得到明显的阶梯音。进度事件只负责「触发」淡出，坡道本身由内部
 * 50ms 定时器按墙上时钟推进；暂停时定时器停摆，elapsed 自然冻结，恢复播放
 * 时坡道从原处继续，不会跳变。
 */
export default class CrossfadeController {
    private readonly applyGain: (gain: number) => void;
    private readonly readSettings: () => CrossfadeSettings | null;
    private readonly now: () => number;
    private readonly setTimer: (handler: () => void, intervalMs: number) => any;
    private readonly clearTimer: (handle: any) => void;

    private gain = 1;
    private lastAppliedGain = 1;
    private ramp: ActiveRamp | null = null;
    private timerHandle: any = null;
    private lastTickAt = 0;
    private enabled = false;
    private fadeSeconds = 0;
    /** 上一次淡出是否跑完了；用来区分「自然结束」和「用户手动切歌」。 */
    private fadedOutForTransition = false;

    constructor(options: CrossfadeControllerOptions) {
        this.applyGain = options.applyGain;
        this.readSettings = options.readSettings;
        this.now = options.now ?? (() => Date.now());
        this.setTimer =
            options.setTimer ??
            ((handler, intervalMs) => setInterval(handler, intervalMs));
        this.clearTimer =
            options.clearTimer ?? ((handle: any) => clearInterval(handle));
    }

    getGain() {
        return this.gain;
    }

    isFading() {
        return this.ramp !== null;
    }

    /** 从配置刷新开关与时长；关掉时把已经压下去的音量平滑收回。 */
    refreshSettings() {
        const settings = this.readSettings();
        const nextEnabled = Boolean(settings?.enabled);
        const nextSeconds = clampCrossfadeSeconds(settings?.seconds);
        const wasEnabled = this.enabled;
        this.enabled = nextEnabled;
        this.fadeSeconds = nextSeconds;

        if (wasEnabled && !nextEnabled) {
            this.ramp = null;
            this.fadedOutForTransition = false;
            if (this.gain < 1) {
                this.startRestoreRamp();
            } else {
                this.stopTimer();
            }
        }
    }

    onPlay() {
        if (this.ramp) {
            this.startTimer();
        }
    }

    onPause() {
        this.stopTimer();
    }

    onProgress(progress: CrossfadeProgress) {
        this.refreshSettings();
        if (!this.enabled) {
            return;
        }

        const decisionInput = {
            position: progress.position,
            duration: progress.duration,
            fadeSeconds: this.fadeSeconds,
        };

        if (this.ramp?.kind === "out") {
            // 用户往回拖出了淡出区，把音量收回去。
            if (shouldCancelFadeOut(decisionInput)) {
                this.startRestoreRamp();
            }
            return;
        }

        // 淡入还在跑的时候不抢占；淡入时长远小于一首歌，不会挡住淡出。
        if (this.ramp) {
            return;
        }

        const fadeOutMs = resolveFadeOutDurationMs(decisionInput);
        if (fadeOutMs !== null) {
            this.ramp = {
                kind: "out",
                durationMs: fadeOutMs,
                elapsedMs: 0,
                fromGain: this.gain,
            };
            this.startTimer();
        }
    }

    onSeeked(progress: CrossfadeProgress) {
        this.refreshSettings();
        if (!this.enabled) {
            return;
        }
        if (
            this.ramp?.kind === "out" &&
            shouldCancelFadeOut({
                position: progress.position,
                duration: progress.duration,
                fadeSeconds: this.fadeSeconds,
            })
        ) {
            this.startRestoreRamp();
        }
    }

    /**
     * 新曲目开始出声。
     *
     * 增益已经被上一首的淡出压到 0 时，说明这是一次自然结束的接力，用完整的
     * 淡化时长淡入；如果增益还是 1（用户直接点了下一首，没经历淡出），就什么
     * 都不做——手动切歌本来就该立刻听到声音，硬压到 0 再花几秒淡起来只会
     * 让人以为卡了。
     */
    onTrackStarted() {
        this.refreshSettings();
        this.ramp = null;

        if (!this.enabled) {
            this.fadedOutForTransition = false;
            if (this.gain < 1) {
                this.startRestoreRamp();
            }
            return;
        }

        if (this.gain >= 1 - GAIN_EPSILON) {
            this.fadedOutForTransition = false;
            this.stopTimer();
            return;
        }

        const naturalTransition = this.fadedOutForTransition;
        this.fadedOutForTransition = false;
        this.ramp = {
            kind: naturalTransition ? "in" : "restore",
            durationMs: naturalTransition
                ? this.fadeSeconds * 1000
                : RESTORE_RAMP_MS,
            elapsedMs: 0,
            fromGain: this.gain,
        };
        this.startTimer();
    }

    /** 硬复位：取消一切坡道并把音量还原到 1。 */
    reset() {
        this.ramp = null;
        this.fadedOutForTransition = false;
        this.stopTimer();
        this.setGain(1, true);
    }

    dispose() {
        this.ramp = null;
        this.stopTimer();
    }

    /** 暴露给测试：手动推进内部时钟。 */
    tickForTest(elapsedMs: number) {
        this.advance(elapsedMs);
    }

    private startRestoreRamp() {
        if (this.gain >= 1 - GAIN_EPSILON) {
            this.ramp = null;
            this.stopTimer();
            this.setGain(1);
            return;
        }
        this.ramp = {
            kind: "restore",
            durationMs: RESTORE_RAMP_MS,
            elapsedMs: 0,
            fromGain: this.gain,
        };
        this.fadedOutForTransition = false;
        this.startTimer();
    }

    private startTimer() {
        if (this.timerHandle !== null) {
            return;
        }
        this.lastTickAt = this.now();
        this.timerHandle = this.setTimer(() => {
            const current = this.now();
            const elapsed = Math.max(0, current - this.lastTickAt);
            this.lastTickAt = current;
            this.advance(elapsed);
        }, TICK_MS);
    }

    private stopTimer() {
        if (this.timerHandle === null) {
            return;
        }
        this.clearTimer(this.timerHandle);
        this.timerHandle = null;
    }

    private advance(elapsedMs: number) {
        const ramp = this.ramp;
        if (!ramp) {
            this.stopTimer();
            return;
        }

        ramp.elapsedMs += elapsedMs;
        const ratio =
            ramp.durationMs <= 0
                ? 1
                : Math.min(1, ramp.elapsedMs / ramp.durationMs);

        let nextGain: number;
        switch (ramp.kind) {
        case "in":
            nextGain = fadeInGain(ratio);
            break;
        case "out":
            nextGain = fadeOutGain(ratio);
            break;
        default:
            nextGain = linearGain(ramp.fromGain, 1, ratio);
            break;
        }
        this.setGain(nextGain);

        if (ratio >= 1) {
            // 淡出跑到底才算「这次切歌是自然结束的」，下一首才配得上完整淡入。
            this.fadedOutForTransition = ramp.kind === "out";
            this.ramp = null;
            this.stopTimer();
        }
    }

    private setGain(gain: number, force = false) {
        const clamped = Math.min(1, Math.max(0, gain));
        this.gain = clamped;
        if (!force && Math.abs(clamped - this.lastAppliedGain) < GAIN_EPSILON) {
            return;
        }
        this.lastAppliedGain = clamped;
        this.applyGain(clamped);
    }
}
