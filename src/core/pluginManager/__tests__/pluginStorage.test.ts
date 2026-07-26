import {
    clearPluginStorageNamespace,
    createPluginStorageFacade,
    PLUGIN_STORAGE_MAX_TOTAL_BYTES,
    PLUGIN_STORAGE_MAX_VALUE_BYTES,
} from "../pluginStorage";

class MemoryStore {
    values = new Map<string, string>();

    getAllKeys() {
        return [...this.values.keys()];
    }

    getString(key: string) {
        return this.values.get(key);
    }

    set(key: string, value: string) {
        this.values.set(key, value);
    }

    delete(key: string) {
        this.values.delete(key);
    }
}

describe("plugin storage facade", () => {
    it("isolates plugins using stable platform identities", async () => {
        const store = new MemoryStore();
        const first = createPluginStorageFacade(store, "source-a");
        const second = createPluginStorageFacade(store, "source-b");
        first.bindIdentity("plugin-a");
        second.bindIdentity("plugin-b");

        await first.facade.setItem("token", "a");
        await second.facade.setItem("token", "b");

        await expect(first.facade.getItem("token")).resolves.toBe("a");
        await expect(second.facade.getItem("token")).resolves.toBe("b");
        expect(store.getAllKeys()).toHaveLength(2);
    });

    it("keeps data across source upgrades after binding the same platform", async () => {
        const store = new MemoryStore();
        const oldVersion = createPluginStorageFacade(store, "old-source");
        oldVersion.bindIdentity("stable-plugin");
        await oldVersion.facade.setItem("history", "kept");

        const newVersion = createPluginStorageFacade(store, "new-source");
        newVersion.bindIdentity("stable-plugin");

        await expect(newVersion.facade.getItem("history")).resolves.toBe(
            "kept",
        );
    });

    it("clears only the uninstalled plugin namespace", async () => {
        const store = new MemoryStore();
        const first = createPluginStorageFacade(store, "first-source");
        const second = createPluginStorageFacade(store, "second-source");
        first.bindIdentity("plugin-a");
        second.bindIdentity("plugin-b");
        await first.facade.setItem("token", "a");
        await second.facade.setItem("token", "b");

        expect(clearPluginStorageNamespace(store, "plugin-a")).toBe(1);
        await expect(first.facade.getItem("token")).resolves.toBeNull();
        await expect(second.facade.getItem("token")).resolves.toBe("b");
    });

    it("moves provisional writes when the plugin identity becomes known", async () => {
        const store = new MemoryStore();
        const plugin = createPluginStorageFacade(store, "source");
        await plugin.facade.setItem("early", "value");

        const report = plugin.bindIdentity("plugin");

        expect(report.namespaceEntries).toBe(1);
        await expect(plugin.facade.getItem("early")).resolves.toBe("value");
        expect(store.getAllKeys()).toHaveLength(1);
    });

    it("only migrates legacy keys that carry an attributable platform prefix", async () => {
        const store = new MemoryStore();
        store.set("plugin-a.token", "owned");
        store.set("ambiguous-token", "quarantined");
        const plugin = createPluginStorageFacade(store, "source");

        const report = plugin.bindIdentity("plugin-a");

        expect(report.legacyEntries).toBe(1);
        expect(report.quarantinedLegacyEntries).toBe(1);
        await expect(plugin.facade.getItem("plugin-a.token")).resolves.toBe(
            "owned",
        );
        expect(store.getString("ambiguous-token")).toBe("quarantined");
    });

    it("rejects oversized values and total quota without replacing data", async () => {
        const store = new MemoryStore();
        const plugin = createPluginStorageFacade(store, "source");
        plugin.bindIdentity("plugin");
        await plugin.facade.setItem("kept", "old");

        await expect(
            plugin.facade.setItem(
                "too-large",
                "x".repeat(PLUGIN_STORAGE_MAX_VALUE_BYTES + 1),
            ),
        ).rejects.toThrow("size limit");
        await expect(plugin.facade.getItem("kept")).resolves.toBe("old");

        await plugin.facade.removeItem("kept");
        const chunk = "x".repeat(PLUGIN_STORAGE_MAX_VALUE_BYTES);
        for (let index = 0; index < PLUGIN_STORAGE_MAX_TOTAL_BYTES / chunk.length; index += 1) {
            await plugin.facade.setItem(`chunk-${index}`, chunk);
        }
        await expect(
            plugin.facade.setItem("overflow", "x"),
        ).rejects.toThrow("quota");
    });

    it("rejects invalid keys", async () => {
        const plugin = createPluginStorageFacade(
            new MemoryStore(),
            "source",
        );
        await expect(plugin.facade.setItem("", "value")).rejects.toThrow(
            "key",
        );
        await expect(
            plugin.facade.getItem("x".repeat(129)),
        ).rejects.toThrow("key");
    });
});
