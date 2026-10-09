jest.mock("../filePersistence", () => ({
    KV_STORE_DIR: "/kv",
    createFilePersistence: () => ({
        read: async () => null,
        write: async () => undefined,
        remove: async () => undefined,
    }),
}));

import {
    configureKeyValueStores,
    flushKeyValueStores,
    getKeyValueStore,
    setKeyValueStorePersistenceForTests,
} from "../index";
import type { IStorePersistence } from "../types";

function persistenceWith(files: Record<string, string>, failWrites = false): IStorePersistence {
    return {
        read: async id => files[id] ?? null,
        write: async (id, contents) => {
            if (failWrites) {
                throw new Error("disk full");
            }
            files[id] = contents;
        },
        remove: async id => {
            delete files[id];
        },
    };
}

// 复核 4b4b833b：App.config 等 store 在模块导入时就建好了，比 bootstrap 注册诊断
// 回调早，它们的读盘损坏、落盘失败都不会留下日志。
describe("key-value store diagnostics", () => {
    it("reports a corrupt snapshot read before the callbacks were registered", async () => {
        setKeyValueStorePersistenceForTests(persistenceWith({ "App.config": "{ not json" }));
        const store = getKeyValueStore("App.config");
        await store.hydrate();

        const onRecover = jest.fn();
        configureKeyValueStores({ onRecover });

        expect(onRecover).toHaveBeenCalledTimes(1);
        expect(onRecover.mock.calls[0][0].storeId).toBe("App.config");
    });

    it("sends failures of stores created earlier to callbacks registered later", async () => {
        setKeyValueStorePersistenceForTests(persistenceWith({}));
        const store = getKeyValueStore("App.config");
        await store.hydrate();

        const onPersistError = jest.fn();
        const onRecover = jest.fn();
        configureKeyValueStores({ onPersistError, onRecover });
        // 走到 store 实际持有的回调：耗尽重试后上报的就是这个
        const options = (store as unknown as { options: { onPersistError: (info: unknown) => void } }).options;
        options.onPersistError({ storeId: "App.config", attempts: 3, error: new Error("disk full") });

        expect(onPersistError).toHaveBeenCalledWith(
            expect.objectContaining({ storeId: "App.config", attempts: 3 }),
        );
    });

    it("tells shutdown whether every store was written", async () => {
        setKeyValueStorePersistenceForTests(persistenceWith({}, true));
        const store = getKeyValueStore("App.PersistStatus");
        await store.hydrate();
        store.set("progress", 80);

        await expect(flushKeyValueStores()).resolves.toBe(false);
    });
});
