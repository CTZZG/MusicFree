import {
    isDownloadWriteResult,
    normalizeDownloadWriteResult,
    waitForDownloadWriteTasks,
} from "../downloadFinalizationPolicy";

describe("isDownloadWriteResult", () => {
    it("accepts only known write statuses", () => {
        expect(isDownloadWriteResult("success")).toBe(true);
        expect(isDownloadWriteResult("failed")).toBe(true);
        expect(isDownloadWriteResult("skipped")).toBe(true);
        expect(isDownloadWriteResult("")).toBe(false);
        expect(isDownloadWriteResult("done")).toBe(false);
        expect(isDownloadWriteResult(undefined)).toBe(false);
    });
});

describe("normalizeDownloadWriteResult", () => {
    it("returns null for unknown write statuses", () => {
        expect(normalizeDownloadWriteResult("success")).toBe("success");
        expect(normalizeDownloadWriteResult("failed")).toBe("failed");
        expect(normalizeDownloadWriteResult("skipped")).toBe("skipped");
        expect(normalizeDownloadWriteResult("done")).toBeNull();
        expect(normalizeDownloadWriteResult(undefined)).toBeNull();
    });
});

describe("waitForDownloadWriteTasks", () => {
    it("waits for metadata and lyric write statuses", async () => {
        await expect(
            waitForDownloadWriteTasks({
                metadata: Promise.resolve("success"),
                lyric: Promise.resolve("skipped"),
            }),
        ).resolves.toEqual({
            metadata: "success",
            lyric: "skipped",
        });
    });

    it("downgrades write failures without rejecting finalization", async () => {
        const errors: Array<[string, string]> = [];

        await expect(
            waitForDownloadWriteTasks({
                metadata: Promise.reject(new Error("tag failed")),
                lyric: Promise.resolve("success"),
                onError(kind, error) {
                    errors.push([
                        kind,
                        error instanceof Error ? error.message : String(error),
                    ]);
                },
            }),
        ).resolves.toEqual({
            metadata: "failed",
            lyric: "success",
        });
        expect(errors).toEqual([["metadata", "tag failed"]]);
    });

    it("downgrades invalid resolved statuses to failed", async () => {
        const errors: Array<[string, string]> = [];

        await expect(
            waitForDownloadWriteTasks({
                metadata: Promise.resolve(undefined),
                lyric: Promise.resolve("done"),
                onError(kind, error) {
                    errors.push([
                        kind,
                        error instanceof Error ? error.message : String(error),
                    ]);
                },
            }),
        ).resolves.toEqual({
            metadata: "failed",
            lyric: "failed",
        });
        expect(errors).toEqual([
            ["metadata", "Invalid download write result: undefined"],
            ["lyric", "Invalid download write result: done"],
        ]);
    });
});
