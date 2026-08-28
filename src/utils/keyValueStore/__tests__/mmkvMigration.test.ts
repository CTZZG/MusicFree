import KeyValueStore from "../store";
import {
    MIGRATION_FLAG_KEY,
    migrateEntries,
    shouldMigrate,
    type IMigrationSource,
} from "../mmkvMigration";
import type { IStorePersistence } from "../types";

const noopPersistence: IStorePersistence = {
    async read() {
        return null;
    },
    async write() {
        // 迁移测试只关心内存状态
    },
    async remove() {
        // 未使用
    },
};

function createTarget() {
    return new KeyValueStore("t", noopPersistence, {
        setTimer: () => 0,
        clearTimer: () => undefined,
    });
}

function createSource(
    values: Record<string, string | number | boolean>,
): IMigrationSource {
    return {
        getAllKeys: () => Object.keys(values),
        getString: key =>
            typeof values[key] === "string"
                ? (values[key] as string)
                : undefined,
        getNumber: key =>
            typeof values[key] === "number"
                ? (values[key] as number)
                : undefined,
        getBoolean: key =>
            typeof values[key] === "boolean"
                ? (values[key] as boolean)
                : undefined,
    };
}

describe("MMKV migration", () => {
    it("runs once and then marks itself done", () => {
        const target = createTarget();
        expect(shouldMigrate(target)).toBe(true);

        const result = migrateEntries(
            createSource({ a: "x", b: 2, c: true }),
            target,
        );

        expect(result).toEqual({ migrated: true, keys: 3, skipped: 0 });
        expect(target.getString("a")).toBe("x");
        expect(target.getNumber("b")).toBe(2);
        expect(target.getBoolean("c")).toBe(true);
        expect(shouldMigrate(target)).toBe(false);
    });

    // 关键：目标里更新的值不能被旧的 MMKV 数据盖掉。
    it("never overwrites values that already exist in the target", () => {
        const target = createTarget();
        target.set("shared", "new-value");

        const result = migrateEntries(
            createSource({ shared: "old-value", fresh: "copied" }),
            target,
        );

        expect(target.getString("shared")).toBe("new-value");
        expect(target.getString("fresh")).toBe("copied");
        expect(result.keys).toBe(1);
        expect(result.skipped).toBe(1);
    });

    // 标记写在目标而不是源：源（MMKV）恰恰可能是写不进去的那一方，
    // 标记丢了会导致每次启动都用旧数据覆盖一遍。
    it("records the flag in the target store", () => {
        const target = createTarget();
        migrateEntries(createSource({}), target);
        expect(target.contains(MIGRATION_FLAG_KEY)).toBe(true);
    });

    it("does not copy the flag key itself", () => {
        const target = createTarget();
        migrateEntries(
            createSource({ [MIGRATION_FLAG_KEY]: "stale", real: "v" }),
            target,
        );
        expect(target.getString(MIGRATION_FLAG_KEY)).not.toBe("stale");
        expect(target.getString("real")).toBe("v");
    });

    it("gives up gracefully when the source cannot be read", () => {
        const target = createTarget();
        const broken: IMigrationSource = {
            getAllKeys: () => {
                throw new Error("mmkv corrupt");
            },
            getString: () => undefined,
            getNumber: () => undefined,
            getBoolean: () => undefined,
        };

        const result = migrateEntries(broken, target);

        expect(result.migrated).toBe(false);
        expect(result.reason).toBe("source-unreadable");
        // 仍然落标记，否则每次启动都会重试一遍注定失败的迁移。
        expect(shouldMigrate(target)).toBe(false);
    });

    it("skips a single unreadable key without aborting the rest", () => {
        const target = createTarget();
        const partly: IMigrationSource = {
            getAllKeys: () => ["ok", "bad", "alsoOk"],
            getString: key => {
                if (key === "bad") {
                    throw new Error("read error");
                }
                return key === "ok" ? "1" : "2";
            },
            getNumber: () => undefined,
            getBoolean: () => undefined,
        };

        const result = migrateEntries(partly, target);

        expect(target.getString("ok")).toBe("1");
        expect(target.getString("alsoOk")).toBe("2");
        expect(result.keys).toBe(2);
        expect(result.skipped).toBe(1);
    });
});
