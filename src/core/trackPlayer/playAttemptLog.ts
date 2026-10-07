import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";

/**
 * 每次播放的来源和结果，只存在手机上（最近 500 次）。用来回答“哪个来源经常
 * 放不了、为什么”：设置里可以看汇总、复制给别人排查。不记歌名。
 *
 * - played：从歌曲自己的来源播放了至少 2 秒
 * - alternate：原来源取不到地址，换到其他来源播放了至少 2 秒（via 是实际来源）
 * - failed：用户看到了“播放未成功”（code 是失败原因）
 */
export type PlayAttemptOutcome = "played" | "alternate" | "failed";

export interface PlayAttempt {
    at: number;
    /** 歌曲原来的来源（插件名） */
    platform: string;
    outcome: PlayAttemptOutcome;
    via?: string;
    code?: string;
    quality?: string;
}

export const MAX_PLAY_ATTEMPTS = 500;
const STORAGE_KEY = "attempts";

const getStore = () => getOrCreateMMKV("play-attempts");
let cache: PlayAttempt[] | null = null;

function isPlayAttempt(value: unknown): value is PlayAttempt {
    const attempt = value as PlayAttempt | null;
    return !!attempt &&
        typeof attempt.at === "number" &&
        typeof attempt.platform === "string" &&
        (attempt.outcome === "played" || attempt.outcome === "alternate" || attempt.outcome === "failed");
}

export function getPlayAttempts(): PlayAttempt[] {
    if (!cache) {
        const raw = getStore().getString(STORAGE_KEY);
        const parsed = raw ? safeParse(raw) : null;
        cache = Array.isArray(parsed) ? parsed.filter(isPlayAttempt) : [];
    }
    return cache;
}

export function recordPlayAttempt(attempt: PlayAttempt) {
    const next = [...getPlayAttempts(), attempt].slice(-MAX_PLAY_ATTEMPTS);
    cache = next;
    getStore().set(STORAGE_KEY, JSON.stringify(next));
}

export function clearPlayAttempts() {
    cache = [];
    getStore().delete(STORAGE_KEY);
}

export interface PlayAttemptSourceSummary {
    platform: string;
    total: number;
    played: number;
    alternate: number;
    failed: number;
    /** 失败原因 → 次数，次数多的在前 */
    failures: Array<[code: string, count: number]>;
    /** 换源时实际用的来源 → 次数 */
    alternates: Array<[platform: string, count: number]>;
}

export interface PlayAttemptSummary {
    total: number;
    sources: PlayAttemptSourceSummary[];
    /** 最近的失败，新的在前 */
    recentFailures: PlayAttempt[];
}

function sortedCounts(counts: Map<string, number>) {
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

/** since 之后（含）的记录按来源汇总，播放次数多的来源在前 */
export function summarizePlayAttempts(
    attempts: readonly PlayAttempt[],
    since = 0,
    recentFailureLimit = 10,
): PlayAttemptSummary {
    const inRange = attempts.filter(attempt => attempt.at >= since);
    const bySource = new Map<string, {
        summary: PlayAttemptSourceSummary;
        failures: Map<string, number>;
        alternates: Map<string, number>;
    }>();
    for (const attempt of inRange) {
        let entry = bySource.get(attempt.platform);
        if (!entry) {
            entry = {
                summary: {
                    platform: attempt.platform,
                    total: 0,
                    played: 0,
                    alternate: 0,
                    failed: 0,
                    failures: [],
                    alternates: [],
                },
                failures: new Map(),
                alternates: new Map(),
            };
            bySource.set(attempt.platform, entry);
        }
        entry.summary.total += 1;
        entry.summary[attempt.outcome] += 1;
        if (attempt.outcome === "failed") {
            const code = attempt.code || "unknown";
            entry.failures.set(code, (entry.failures.get(code) ?? 0) + 1);
        } else if (attempt.outcome === "alternate" && attempt.via) {
            entry.alternates.set(attempt.via, (entry.alternates.get(attempt.via) ?? 0) + 1);
        }
    }
    const sources = [...bySource.values()].map(({ summary, failures, alternates }) => ({
        ...summary,
        failures: sortedCounts(failures),
        alternates: sortedCounts(alternates),
    }));
    sources.sort((left, right) => right.total - left.total || left.platform.localeCompare(right.platform));
    return {
        total: inRange.length,
        sources,
        recentFailures: inRange
            .filter(attempt => attempt.outcome === "failed")
            .slice(-recentFailureLimit)
            .reverse(),
    };
}
