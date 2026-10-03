import {
    buildPluginDiagnosticReport,
    clearPluginDiagnosticEvents,
    getPluginDiagnosticSeverity,
    getRecentPluginDiagnosticErrors,
    isRecentPluginDiagnosticEvent,
    recentPluginDiagnosticWindowMs,
    recordPluginDiagnosticError,
    recordPluginDiagnosticMessage,
    recordPluginInstallFailure,
} from "../diagnostics";

const mockDiagnosticValues = new Map<string, string>();

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: () => ({
        getString: (key: string) => mockDiagnosticValues.get(key),
        set: (key: string, value: string) => {
            mockDiagnosticValues.set(key, value);
        },
        delete: (key: string) => {
            mockDiagnosticValues.delete(key);
        },
    }),
}));

describe("plugin diagnostics sanitization", () => {
    beforeEach(() => {
        clearPluginDiagnosticEvents();
    });

    it("redacts URLs, credentials, headers, and local paths", () => {
        const event = recordPluginDiagnosticMessage({
            pluginName: "test",
            method: "capability",
            severity: "info",
            message: [
                "https://example.com/media/song.mp3?token=secret",
                "authorization: Bearer-secret",
                "file:///storage/emulated/0/private.mp3",
            ].join(" "),
        });

        expect(event.message).not.toContain("example.com");
        expect(event.message).not.toContain("secret");
        expect(event.message).not.toContain("private.mp3");
        expect(event.message).toContain("<remote-url>");
    });

    it("stores capability denials without request payload data", () => {
        const event = recordPluginDiagnosticMessage({
            pluginName: "test",
            pluginHash: "hash",
            method: "capability",
            severity: "info",
            message:
                "outcome=denied; capability=network.http; reason=url-policy",
        });

        expect(event).toMatchObject({
            pluginName: "test",
            pluginHash: "hash",
            method: "capability",
            message:
                "outcome=denied; capability=network.http; reason=url-policy",
        });
    });
    // Regression: events were only trimmed by count (20/plugin, 200 total), never
    // by age, and the plugin list showed the latest event per plugin. Every
    // failure since install therefore stayed visible forever -- including ones
    // already fixed -- which is why "every plugin has an error" was reported.
    describe("recency window", () => {
        const now = 1_700_000_000_000;

        it("keeps an event inside the window", () => {
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now - 1000 },
                now,
            )).toBe(true);
        });

        it("drops an event older than the window", () => {
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now - recentPluginDiagnosticWindowMs - 1 },
                now,
            )).toBe(false);
        });

        it("treats a future timestamp as recent rather than hiding it", () => {
            // A device whose clock moved backwards must not silently hide live
            // errors.
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now + 60_000 },
                now,
            )).toBe(true);
        });
    });
});

/**
 * 回归背景：插件卡片的「最近错误」显示的是最新的任意事件，每个插件每次启动都
 * 记一条 storage-migration · quarantinedLegacyEntries=1（共享存储里一条归属不到
 * 任何插件的旧数据），用到能力的记录也会顶上去。现在只有 error 才算错误。
 */
describe("plugin diagnostic severity", () => {
    beforeEach(() => {
        clearPluginDiagnosticEvents();
    });

    it("records the severity each caller chose", () => {
        const error = recordPluginDiagnosticMessage({
            pluginName: "p",
            method: "search",
            message: "boom",
            severity: "error",
        });
        const info = recordPluginDiagnosticMessage({
            pluginName: "p",
            method: "capability",
            message: "outcome=allowed; capability=network",
            severity: "info",
        });

        expect(error.severity).toBe("error");
        expect(info.severity).toBe("info");
    });

    it("shows only errors as a plugin's recent error", () => {
        recordPluginDiagnosticMessage({
            pluginName: "p",
            pluginHash: "h",
            method: "search",
            message: "network failed",
            severity: "error",
        });
        recordPluginDiagnosticMessage({
            pluginName: "p",
            pluginHash: "h",
            method: "storage-migration",
            message: "legacyEntries=1; unattributedLegacyEntries=1",
            severity: "info",
        });

        const errors = getRecentPluginDiagnosticErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].method).toBe("search");
    });

    it("treats events stored before severity existed by their method", () => {
        const legacy = { createdAt: Date.now() };
        expect(
            getPluginDiagnosticSeverity({ ...legacy, method: "storage-migration" }),
        ).toBe("info");
        expect(
            getPluginDiagnosticSeverity({ ...legacy, method: "capability" }),
        ).toBe("info");
        expect(getPluginDiagnosticSeverity({ ...legacy, method: "mount" })).toBe(
            "error",
        );
    });

    it("counts only recent errors in a plugin's report summary", () => {
        const plugin = {
            name: "p",
            hash: "h",
            supportedMethods: new Set<string>(),
            instance: { version: "1.0.0", author: "a" },
        } as any;
        recordPluginDiagnosticMessage({
            pluginName: "p",
            pluginHash: "h",
            method: "capability",
            message: "outcome=allowed; capability=network",
            severity: "info",
        });
        recordPluginDiagnosticMessage({
            pluginName: "p",
            pluginHash: "h",
            method: "storage-migration",
            message: "legacyEntries=1",
            severity: "info",
        });

        const infoOnly = buildPluginDiagnosticReport([plugin]);
        expect(infoOnly).toContain("recentErrors=0");
        expect(infoOnly).toContain("events=2");

        recordPluginDiagnosticMessage({
            pluginName: "p",
            pluginHash: "h",
            method: "search",
            message: "network failed",
            severity: "error",
        });
        expect(buildPluginDiagnosticReport([plugin])).toContain(
            "recentErrors=1",
        );
    });

    it("records thrown errors and failed installs as errors", () => {
        expect(
            recordPluginDiagnosticError({
                pluginName: "p",
                method: "getMediaSource",
                error: new Error("HTTP 403"),
            }).severity,
        ).toBe("error");
        expect(
            recordPluginInstallFailure({
                success: false,
                message: "下载失败",
                pluginName: "p",
            } as any)?.severity,
        ).toBe("error");
    });

    it("does not let a new event leave its severity out", () => {
        // 编译期检查：verify 会跑 tsc。severity 若又变回可选，下面那条
        // 「期待报错」的指令就落空，tsc 会因此失败
        const event = recordPluginDiagnosticMessage(
            // @ts-expect-error severity 必填
            { pluginName: "p", method: "search", message: "boom" },
        );
        // 绕过类型检查漏写时，按 method 推断，与落盘的旧事件一样
        expect(getPluginDiagnosticSeverity(event)).toBe("error");
    });

    it("labels each event's severity in the diagnostic report", () => {
        recordPluginDiagnosticMessage({
            pluginName: "p",
            method: "capability",
            message: "outcome=allowed",
            severity: "info",
        });

        expect(buildPluginDiagnosticReport([])).toContain("p capability [info]");
    });
});
