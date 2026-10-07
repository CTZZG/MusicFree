import { getMediaSourceFailureI18nKey } from "@/core/pluginManager/mediaSourceFailure";
import type { PlayAttemptSummary } from "./playAttemptLog";

type Translate = (key: any, args?: Record<string, unknown>) => string;

function pad(value: number) {
    return String(value).padStart(2, "0");
}

/** 本地时间 10-07 12:03 */
export function formatAttemptTime(at: number) {
    const date = new Date(at);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function failureReason(code: string, t: Translate) {
    return t(getMediaSourceFailureI18nKey(code));
}

/** 设置里“播放统计”显示和复制的文字 */
export function formatPlayAttemptReport(
    summary: PlayAttemptSummary,
    days: number,
    t: Translate,
    formatTime: (at: number) => string = formatAttemptTime,
) {
    if (summary.total === 0) {
        return t("playAttempts.empty", { days });
    }
    const lines = [t("playAttempts.summary", { days, total: summary.total }), ""];
    for (const source of summary.sources) {
        let line = t("playAttempts.source", {
            platform: source.platform,
            total: source.total,
            played: source.played,
        });
        if (source.alternate) {
            line += t("playAttempts.sourceAlternate", { count: source.alternate });
        }
        if (source.failed) {
            line += t("playAttempts.sourceFailed", { count: source.failed });
        }
        lines.push(line);
        for (const [platform, count] of source.alternates) {
            lines.push(t("playAttempts.alternateVia", { platform, count }));
        }
        for (const [code, count] of source.failures) {
            lines.push(t("playAttempts.failureReason", { reason: failureReason(code, t), count }));
        }
    }
    if (summary.recentFailures.length) {
        lines.push("", t("playAttempts.recentFailures"));
        for (const attempt of summary.recentFailures) {
            lines.push(t("playAttempts.recentFailure", {
                time: formatTime(attempt.at),
                platform: attempt.platform,
                reason: failureReason(attempt.code || "unknown", t),
            }));
        }
    }
    lines.push("", t("playAttempts.note"));
    return lines.join("\n");
}
