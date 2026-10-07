const mockStorage = new Map<string, string>();

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: () => ({
        getString: (key: string) => mockStorage.get(key),
        set: (key: string, value: string) => mockStorage.set(key, value),
        delete: (key: string) => mockStorage.delete(key),
    }),
}));

import type { PlayAttempt } from "../playAttemptLog";

function load() {
    let mod: typeof import("../playAttemptLog");
    jest.isolateModules(() => {
        mod = require("../playAttemptLog");
    });
    return mod!;
}

const attempt = (overrides: Partial<PlayAttempt>): PlayAttempt => ({
    at: 1000,
    platform: "源A",
    outcome: "played",
    ...overrides,
});

describe("play attempt log", () => {
    beforeEach(() => {
        mockStorage.clear();
    });

    it("keeps the most recent 500 attempts across restarts", () => {
        const log = load();
        for (let index = 0; index < 505; index++) {
            log.recordPlayAttempt(attempt({ at: index }));
        }
        expect(log.getPlayAttempts()).toHaveLength(500);
        expect(log.getPlayAttempts()[0].at).toBe(5);

        // 重新启动后从存储里读回来
        const restarted = load();
        expect(restarted.getPlayAttempts()).toHaveLength(500);
        expect(restarted.getPlayAttempts().at(-1)?.at).toBe(504);

        restarted.clearPlayAttempts();
        expect(load().getPlayAttempts()).toEqual([]);
    });

    it("ignores damaged storage instead of failing", () => {
        mockStorage.set("attempts", "{not json");
        expect(load().getPlayAttempts()).toEqual([]);

        mockStorage.set("attempts", JSON.stringify([attempt({}), { at: "x" }, null, attempt({ outcome: "bogus" as any })]));
        expect(load().getPlayAttempts()).toEqual([attempt({})]);
    });
});

describe("summarizePlayAttempts", () => {
    const { summarizePlayAttempts } = load();

    it("counts each source's plays, alternates and failures with their reasons", () => {
        const summary = summarizePlayAttempts([
            attempt({ at: 1 }),
            attempt({ at: 2, outcome: "alternate", via: "源B" }),
            attempt({ at: 3, outcome: "failed", code: "unavailable" }),
            attempt({ at: 4, outcome: "failed", code: "access-denied" }),
            attempt({ at: 5, outcome: "failed", code: "unavailable" }),
            attempt({ at: 6, platform: "源B" }),
            attempt({ at: 7, outcome: "failed", platform: "源C" }),
        ]);

        expect(summary.total).toBe(7);
        expect(summary.sources[0]).toEqual({
            platform: "源A",
            total: 5,
            played: 1,
            alternate: 1,
            failed: 3,
            failures: [["unavailable", 2], ["access-denied", 1]],
            alternates: [["源B", 1]],
        });
        expect(summary.sources.map(source => source.platform)).toEqual(["源A", "源B", "源C"]);
        expect(summary.sources[2].failures).toEqual([["unknown", 1]]);
        // 新的失败在前
        expect(summary.recentFailures.map(item => item.at)).toEqual([7, 5, 4, 3]);
    });

    it("only counts attempts since the given time and limits the failure list", () => {
        const attempts = Array.from({ length: 30 }, (_, index) =>
            attempt({ at: index, outcome: "failed", code: "network-error" }));
        const summary = summarizePlayAttempts(attempts, 10, 5);
        expect(summary.total).toBe(20);
        expect(summary.recentFailures.map(item => item.at)).toEqual([29, 28, 27, 26, 25]);
        expect(summarizePlayAttempts([], 0)).toEqual({ total: 0, sources: [], recentFailures: [] });
    });
});
