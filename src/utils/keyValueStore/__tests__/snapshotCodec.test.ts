import {
    decodeSnapshot,
    encodeSnapshot,
    SNAPSHOT_VERSION,
    toStoredValue,
} from "../snapshotCodec";

describe("snapshot codec", () => {
    it("round-trips all three value types", () => {
        const entries = {
            a: { t: "s" as const, v: "text" },
            b: { t: "n" as const, v: 42 },
            c: { t: "b" as const, v: true },
        };
        const decoded = decodeSnapshot(encodeSnapshot(entries));
        expect(decoded.recovered).toBe(false);
        expect(decoded.entries).toEqual(entries);
    });

    it("treats absent input as an empty store without flagging recovery", () => {
        for (const raw of [null, undefined, ""]) {
            const decoded = decodeSnapshot(raw);
            expect(decoded.entries).toEqual({});
            expect(decoded.recovered).toBe(false);
        }
    });

    // 存储层抛异常会让整个应用起不来，所以损坏必须降级而不是抛。但降级
    // 必须可观察——静默丢数据正是旧方案最难查的地方。
    it.each([
        ["not json at all", "invalid-json"],
        ["[]", "not-an-object"],
        ["{\"version\":99,\"entries\":{}}", "unsupported-version:99"],
        [`{"version":${SNAPSHOT_VERSION}}`, "missing-entries"],
    ])("degrades gracefully and reports why: %s", (raw, reason) => {
        const decoded = decodeSnapshot(raw);
        expect(decoded.entries).toEqual({});
        expect(decoded.recovered).toBe(true);
        expect(decoded.reason).toBe(reason);
    });

    it("keeps good entries when only some are corrupt", () => {
        const raw = JSON.stringify({
            version: SNAPSHOT_VERSION,
            entries: {
                good: { t: "s", v: "keep" },
                badType: { t: "x", v: 1 },
                badValue: { t: "n", v: "not-a-number" },
                nested: null,
            },
        });
        const decoded = decodeSnapshot(raw);
        expect(decoded.entries).toEqual({ good: { t: "s", v: "keep" } });
        expect(decoded.recovered).toBe(true);
        expect(decoded.reason).toBe("dropped-entries:3");
    });

    it("rejects numbers that cannot survive a JSON round-trip", () => {
        expect(toStoredValue(Number.NaN)).toBeNull();
        expect(toStoredValue(Number.POSITIVE_INFINITY)).toBeNull();
        expect(toStoredValue(0)).toEqual({ t: "n", v: 0 });
    });

    it("classifies each primitive it accepts", () => {
        expect(toStoredValue("")).toEqual({ t: "s", v: "" });
        expect(toStoredValue(false)).toEqual({ t: "b", v: false });
    });
});
