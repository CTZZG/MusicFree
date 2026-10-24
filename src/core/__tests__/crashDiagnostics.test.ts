jest.mock("@/native/utils", () => ({
    __esModule: true,
    default: {
        getCrashDiagnostics: jest.fn(),
        clearCrashDiagnostics: jest.fn(),
    },
}));

import NativeUtils from "@/native/utils";
import {
    clearCrashDiagnostics,
    loadCrashDiagnostics,
    redactCrashText,
} from "../crashDiagnostics";

const native = NativeUtils as jest.Mocked<Required<typeof NativeUtils>>;

describe("crash diagnostics", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keeps host and path but hides query strings and credentials", () => {
        expect(
            redactCrashText(
                "IOException: https://cdn.example.com/a/b.mp3?vkey=SECRET&guid=1 failed",
            ),
        ).toBe("IOException: https://cdn.example.com/a/b.mp3?… failed");
        expect(redactCrashText("token=abc&page=2")).toBe("token=***&page=2");
        expect(redactCrashText("Cookie: uin=1; skey=2\nnext line")).toBe(
            "Cookie: ***\nnext line",
        );
    });

    it("redacts every free-text field and counts abnormal exits", async () => {
        native.getCrashDiagnostics.mockResolvedValue({
            clearedBefore: 0,
            javaCrashes: [{
                at: 3,
                thread: "main",
                appVersion: "0.12.1 (400034)",
                exception: "java.io.IOException",
                message: "GET https://h.example/x?sign=1",
                stack: "java.io.IOException: https://h.example/x?sign=1\n\tat A.b(A.kt:1)",
            }],
            exits: [
                {
                    at: 3, reason: "crash", abnormal: true, status: 0, importance: 100,
                    pssKb: 1, rssKb: 2, javaCrashRecorded: true,
                },
                {
                    at: 2, reason: "crash-native", abnormal: true, status: 11, importance: 125,
                    pssKb: 1, rssKb: 2,
                    nativeCrash: {
                        signal: "SIGSEGV",
                        abortMessage: "bad url https://h.example/y?token=z",
                        causes: ["null pointer dereference"],
                        frames: ["#00 pc 00001234  /data/app/lib/arm64/libmpv.so (mp_foo+12)"],
                    },
                },
                {
                    at: 1, reason: "signaled", abnormal: false, status: 9, importance: 125,
                    pssKb: 1, rssKb: 2, description: "stop user 0 token=t",
                },
            ],
        });

        const report = await loadCrashDiagnostics();

        expect(report.available).toBe(true);
        expect(report.abnormalExitCount).toBe(2);
        expect(report.javaCrashes?.[0].message).toBe("GET https://h.example/x?…");
        expect(report.javaCrashes?.[0].stack).not.toContain("sign=1");
        expect(report.exits?.[1].nativeCrash?.abortMessage).toBe("bad url https://h.example/y?…");
        expect(report.exits?.[1].nativeCrash?.frames).toEqual([
            "#00 pc 00001234  /data/app/lib/arm64/libmpv.so (mp_foo+12)",
        ]);
        expect(report.exits?.[2].description).toBe("stop user 0 token=***");
    });

    it("hides URL credentials and quoted header values in exception text", () => {
        expect(redactCrashText("GET https://alice:example-password@cdn.example/a?sign=example-sign"))
            .toBe("GET https://***@cdn.example/a?…");
        const headers = JSON.stringify({
            Authorization: "Bearer example-token",
            Cookie: "session=example-cookie",
            "x-visible": "keep this",
            access_token: "example-access-token",
        });
        expect(JSON.parse(redactCrashText(headers))).toEqual({
            Authorization: "***",
            Cookie: "***",
            "x-visible": "keep this",
            access_token: "***",
        });
        expect(redactCrashText("{'password': 'example-password'}"))
            .toBe("{'password': \"***\"}");
    });

    it.each([1, 2, 3])("redacts headers serialized %i times before the report is copied", async levels => {
        let message = JSON.stringify({
            Authorization: "Bearer synthetic-nested-token",
            Cookie: "session=synthetic-nested-cookie",
            url: "https://user:synthetic-url-password@cdn.example/audio?token=synthetic-query",
            status: 503,
        });
        for (let level = 0; level < levels; level++) {
            message = JSON.stringify({ response: message });
        }
        // Some exception libraries wrap a serialized response in prose/stack text.
        const stack = `IOException: ${message}\n\tat Player.load(Player.kt:42)`;
        native.getCrashDiagnostics.mockResolvedValue({
            clearedBefore: 0,
            javaCrashes: [{
                at: 1, thread: "main", appVersion: "test", exception: "IOException",
                message, stack,
            }],
            exits: [],
        });

        // Same native -> report -> JSON serialization used by the copy-diagnostics action.
        const report = await loadCrashDiagnostics();
        const copied = JSON.stringify({ crashes: report }, null, 2);
        for (const secret of ["synthetic-nested-token", "synthetic-nested-cookie",
            "synthetic-url-password", "synthetic-query"]) {
            expect(copied).not.toContain(secret);
        }
        let response = report.javaCrashes![0].message;
        for (let level = 0; level < levels; level++) {
            response = JSON.parse(response).response;
        }
        expect(JSON.parse(response)).toEqual({
            Authorization: "***", Cookie: "***", url: "https://***@cdn.example/audio?…", status: 503,
        });
        expect(report.javaCrashes![0].stack).toContain("Player.load(Player.kt:42)");
    });

    it("redacts escaped URLs and structured secret values without losing useful fields", () => {
        const message = JSON.stringify({
            url: "https://user:synthetic-password@cdn.example/audio?token=synthetic-query",
            headers: { AUTHORIZATION: { value: "synthetic-header" }, access_token: 12345 },
            items: [{ "api-key": 67890, status: 502 }],
            ["__proto__"]: { password: "synthetic-proto" },
        }).replace(/\//g, "\\/");
        expect(JSON.parse(redactCrashText(message))).toEqual({
            url: "https://***@cdn.example/audio?…",
            headers: { AUTHORIZATION: "***", access_token: "***" },
            items: [{ "api-key": "***", status: 502 }],
            ["__proto__"]: { password: "***" },
        });
        expect(redactCrashText("GET https:\\/\\/user:synthetic-password@cdn.example\\/audio?token=synthetic-query failed"))
            .toBe("GET https://***@cdn.example/audio?… failed");
    });

    it("stops decoding at a nesting limit and preserves surrounding stack locations", () => {
        let message = JSON.stringify({ Authorization: "synthetic-deep-token" });
        for (let level = 0; level < 8; level++) {
            message = JSON.stringify({ nested: message });
        }
        const redacted = redactCrashText(`IOException: ${message}\n\tat Player.kt:42`);
        expect(redacted).not.toContain("synthetic-deep-token");
        expect(redacted).toContain("[redacted: nesting limit]");
        expect(redacted).toContain("Player.kt:42");
    });

    it.each([1, 2, 3])("hides credentials when a %i-times serialized message is truncated by native storage", levels => {
        let message = JSON.stringify({
            Authorization: "Bearer synthetic-truncated-token", padding: "x".repeat(2000),
        });
        for (let level = 0; level < levels; level++) {
            message = JSON.stringify({ response: message });
        }
        const redacted = redactCrashText(`IOException: ${message.slice(0, 1000)}\n\tat Player.kt:42`);
        expect(redacted).not.toContain("synthetic-truncated-token");
        expect(redacted).toContain("[redacted: invalid JSON string]");
        expect(redacted).toContain("Player.kt:42");
    });

    it("reports a native failure instead of throwing", async () => {
        native.getCrashDiagnostics.mockRejectedValue(new Error("boom https://x.example/p?a=1"));

        await expect(loadCrashDiagnostics()).resolves.toEqual({
            available: false,
            error: "boom https://x.example/p?…",
        });
    });

    it("never lets a failed clear break clearing the error log", async () => {
        native.clearCrashDiagnostics.mockRejectedValue(new Error("io"));
        await expect(clearCrashDiagnostics()).resolves.toBe(false);
        native.clearCrashDiagnostics.mockResolvedValue(true);
        await expect(clearCrashDiagnostics()).resolves.toBe(true);
    });
});
