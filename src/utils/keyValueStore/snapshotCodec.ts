import type { IStoreSnapshot, StoredValue } from "./types";

export const SNAPSHOT_VERSION = 1 as const;

function isStoredValue(value: unknown): value is StoredValue {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as { t?: unknown; v?: unknown };
    if (candidate.t === "s") {
        return typeof candidate.v === "string";
    }
    if (candidate.t === "n") {
        return typeof candidate.v === "number" && Number.isFinite(candidate.v);
    }
    if (candidate.t === "b") {
        return typeof candidate.v === "boolean";
    }
    return false;
}

export function encodeSnapshot(
    entries: Record<string, StoredValue>,
): string {
    const snapshot: IStoreSnapshot = {
        version: SNAPSHOT_VERSION,
        entries,
    };
    return JSON.stringify(snapshot);
}

/**
 * 解析快照。任何形式的损坏都退化为空表而不是抛异常——存储层崩溃会让整个
 * 应用起不来，而丢一份缓存只是退化。返回值同时告知调用方是否发生了降级，
 * 便于上层记录诊断（静默丢数据是此前 MMKV 方案最难查的地方）。
 */
export function decodeSnapshot(raw: string | null | undefined): {
    entries: Record<string, StoredValue>;
    recovered: boolean;
    reason?: string;
} {
    if (raw === null || raw === undefined || raw === "") {
        return { entries: {}, recovered: false };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { entries: {}, recovered: true, reason: "invalid-json" };
    }

    // 数组也是 object，但绝不是合法快照；先排除掉它再看版本，否则会报出
    // 令人误解的 "unsupported-version:undefined"。
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { entries: {}, recovered: true, reason: "not-an-object" };
    }

    const candidate = parsed as Partial<IStoreSnapshot>;
    if (candidate.version !== SNAPSHOT_VERSION) {
        return {
            entries: {},
            recovered: true,
            reason: `unsupported-version:${String(candidate.version)}`,
        };
    }
    if (!candidate.entries || typeof candidate.entries !== "object") {
        return { entries: {}, recovered: true, reason: "missing-entries" };
    }

    // 逐条校验：只丢弃坏条目，保住其余的。整份丢弃会把一个坏键的代价放大
    // 成全部设置归零。
    const entries: Record<string, StoredValue> = {};
    let dropped = 0;
    for (const [key, value] of Object.entries(candidate.entries)) {
        if (isStoredValue(value)) {
            entries[key] = value;
        } else {
            dropped += 1;
        }
    }

    return dropped > 0
        ? { entries, recovered: true, reason: `dropped-entries:${dropped}` }
        : { entries, recovered: false };
}

export function toStoredValue(
    value: string | number | boolean,
): StoredValue | null {
    if (typeof value === "string") {
        return { t: "s", v: value };
    }
    if (typeof value === "number") {
        // NaN / Infinity 无法在 JSON 里往返，直接拒绝而不是写入一个
        // 读出来变成 null 的值。
        return Number.isFinite(value) ? { t: "n", v: value } : null;
    }
    if (typeof value === "boolean") {
        return { t: "b", v: value };
    }
    return null;
}
