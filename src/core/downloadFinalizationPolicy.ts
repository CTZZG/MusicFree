export type DownloadWriteResult = "success" | "failed" | "skipped";
export type DownloadWriteTaskKind = "metadata" | "lyric";

export function isDownloadWriteResult(
    result: unknown,
): result is DownloadWriteResult {
    return result === "success" || result === "failed" || result === "skipped";
}

export function normalizeDownloadWriteResult(
    result: unknown,
): DownloadWriteResult | null {
    return isDownloadWriteResult(result) ? result : null;
}

export async function waitForDownloadWriteTasks(params: {
    metadata: Promise<unknown>;
    lyric: Promise<unknown>;
    onError?: (kind: DownloadWriteTaskKind, error: unknown) => void;
}) {
    const settle = async (
        kind: DownloadWriteTaskKind,
        task: Promise<unknown>,
    ) => {
        try {
            const result = await task;
            const normalizedResult = normalizeDownloadWriteResult(result);
            if (normalizedResult) {
                return normalizedResult;
            }
            params.onError?.(
                kind,
                new Error(`Invalid download write result: ${String(result)}`),
            );
            return "failed" as const;
        } catch (error) {
            params.onError?.(kind, error);
            return "failed" as const;
        }
    };

    const [metadata, lyric] = await Promise.all([
        settle("metadata", params.metadata),
        settle("lyric", params.lyric),
    ]);

    return {
        metadata,
        lyric,
    };
}
