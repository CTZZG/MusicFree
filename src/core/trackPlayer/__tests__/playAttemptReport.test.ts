import zhCN from "@/core/i18n/languages/zh-cn.json";
import { summarizePlayAttempts, type PlayAttempt } from "../playAttemptLog";
import { formatAttemptTime, formatPlayAttemptReport } from "../playAttemptReport";

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: () => ({ getString: () => undefined, set: () => undefined, delete: () => undefined }),
}));

const strings = zhCN as Record<string, string>;
const t = (key: string, args: Record<string, unknown> = {}) =>
    (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(args[name]));

describe("formatPlayAttemptReport", () => {
    it("explains an empty log", () => {
        expect(formatPlayAttemptReport(summarizePlayAttempts([]), 7, t)).toBe(
            "最近 7 天还没有播放记录。之后播放的歌会记在这里（只记来源和结果，不记歌名，只存在本机）。",
        );
    });

    it("lists each source with switches, reasons and the recent failures", () => {
        const attempts: PlayAttempt[] = [
            { at: 1, platform: "QQ音乐", outcome: "played" },
            { at: 2, platform: "QQ音乐", outcome: "alternate", via: "酷狗" },
            { at: 3, platform: "QQ音乐", outcome: "failed", code: "access-denied" },
            { at: 4, platform: "酷狗", outcome: "played" },
        ];
        const report = formatPlayAttemptReport(summarizePlayAttempts(attempts), 7, t, at => `T${at}`);
        expect(report.split("\n")).toEqual([
            "最近 7 天播放 4 次",
            "",
            "QQ音乐：3 次，正常播放 1，换源播放 1，失败 1",
            "  · 换到 酷狗：1 次",
            "  · 音源拒绝访问，请检查插件授权或配置：1 次",
            "酷狗：1 次，正常播放 1",
            "",
            "最近的失败",
            "T3  QQ音乐：音源拒绝访问，请检查插件授权或配置",
            "",
            strings["playAttempts.note"],
        ]);
    });

    it("formats times as month-day hour:minute in local time", () => {
        expect(formatAttemptTime(new Date(2026, 9, 7, 9, 5).getTime())).toBe("10-07 09:05");
    });
});
