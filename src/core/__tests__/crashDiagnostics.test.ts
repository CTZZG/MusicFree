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
