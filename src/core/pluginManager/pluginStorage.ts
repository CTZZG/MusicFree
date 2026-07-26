import CryptoJs from "crypto-js";
import { Buffer } from "buffer";

export const PLUGIN_STORAGE_MAX_KEY_BYTES = 128;
export const PLUGIN_STORAGE_MAX_VALUE_BYTES = 256 * 1024;
export const PLUGIN_STORAGE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

export interface PluginStorageBackingStore {
    getAllKeys(): string[];
    getString(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
}

export interface PluginStorageMigrationReport {
    namespaceEntries: number;
    legacyEntries: number;
    quarantinedLegacyEntries: number;
}

function byteLength(value: string) {
    return Buffer.byteLength(value, "utf8");
}

function identityNamespace(identity: string) {
    const digest = CryptoJs.SHA256(
        `musicfree-plugin-storage:${identity.trim().toLowerCase()}`,
    ).toString();
    return `v2:${digest}:`;
}

export function clearPluginStorageNamespace(
    store: PluginStorageBackingStore,
    platform: string,
) {
    if (!platform?.trim()) {
        return 0;
    }
    const namespace = identityNamespace(`platform:${platform}`);
    const keys = store.getAllKeys().filter(key => key.startsWith(namespace));
    keys.forEach(key => store.delete(key));
    return keys.length;
}

function isLegacyKeyOwnedByPlatform(key: string, platform: string) {
    const normalized = platform.trim().toLowerCase();
    const candidate = key.toLowerCase();
    return (
        candidate.startsWith(`${normalized}.`) ||
        candidate.startsWith(`${normalized}:`) ||
        candidate.startsWith(`${normalized}/`)
    );
}

export function createPluginStorageFacade(
    store: PluginStorageBackingStore,
    provisionalIdentity: string,
) {
    let namespace = identityNamespace(`provisional:${provisionalIdentity}`);
    let boundPlatform: string | null = null;
    let migrationReport: PluginStorageMigrationReport = {
        namespaceEntries: 0,
        legacyEntries: 0,
        quarantinedLegacyEntries: 0,
    };

    function getNamespacedKeys() {
        return store.getAllKeys().filter(key => key.startsWith(namespace));
    }

    function namespacedKey(key: string) {
        if (typeof key !== "string" || !key || byteLength(key) > PLUGIN_STORAGE_MAX_KEY_BYTES) {
            throw new Error("Plugin storage key is empty or exceeds the limit");
        }
        if (key.includes("\0")) {
            throw new Error("Plugin storage key contains an invalid character");
        }
        return `${namespace}${key}`;
    }

    function migrateNamespace(nextNamespace: string) {
        if (nextNamespace === namespace) {
            return 0;
        }
        const previousNamespace = namespace;
        const entries = store.getAllKeys()
            .filter(key => key.startsWith(previousNamespace))
            .map(key => ({
                oldKey: key,
                logicalKey: key.slice(previousNamespace.length),
                value: store.getString(key),
            }));
        namespace = nextNamespace;
        let migrated = 0;
        entries.forEach(({ oldKey, logicalKey, value }) => {
            if (value !== undefined) {
                const destination = `${namespace}${logicalKey}`;
                if (store.getString(destination) === undefined) {
                    store.set(destination, value);
                }
                migrated += 1;
            }
            store.delete(oldKey);
        });
        return migrated;
    }

    function migrateOwnedLegacyKeys(platform: string) {
        let migrated = 0;
        const allKeys = store.getAllKeys();
        allKeys.forEach(key => {
            if (key.startsWith("v2:")) {
                return;
            }
            if (!isLegacyKeyOwnedByPlatform(key, platform)) {
                return;
            }
            const value = store.getString(key);
            if (value !== undefined) {
                const destination = `${namespace}${key}`;
                if (store.getString(destination) === undefined) {
                    store.set(destination, value);
                }
                store.delete(key);
                migrated += 1;
            }
        });
        return {
            migrated,
            quarantined: store.getAllKeys().filter(
                key => !key.startsWith("v2:"),
            ).length,
        };
    }

    const facade = {
        async setItem(key: string, value: unknown) {
            const storageKey = namespacedKey(key);
            const nextValue = typeof value === "string"
                ? value
                : value == null
                    ? ""
                    : String(value);
            const nextValueBytes = byteLength(nextValue);
            if (nextValueBytes > PLUGIN_STORAGE_MAX_VALUE_BYTES) {
                throw new Error("Plugin storage value exceeds the size limit");
            }

            const existingBytes = byteLength(
                store.getString(storageKey) ?? "",
            );
            const currentBytes = getNamespacedKeys().reduce(
                (total, itemKey) =>
                    total + byteLength(store.getString(itemKey) ?? ""),
                0,
            );
            if (
                currentBytes - existingBytes + nextValueBytes >
                PLUGIN_STORAGE_MAX_TOTAL_BYTES
            ) {
                throw new Error("Plugin storage quota exceeded");
            }
            store.set(storageKey, nextValue);
        },
        async getItem(key: string) {
            return store.getString(namespacedKey(key)) ?? null;
        },
        async removeItem(key: string) {
            store.delete(namespacedKey(key));
        },
    };

    return {
        facade: Object.freeze(facade),
        bindIdentity(platform: string) {
            if (!platform?.trim()) {
                throw new Error("Plugin storage identity is required");
            }
            if (boundPlatform && boundPlatform !== platform) {
                throw new Error("Plugin storage identity is already bound");
            }
            boundPlatform = platform;
            const namespaceEntries = migrateNamespace(
                identityNamespace(`platform:${platform}`),
            );
            const legacy = migrateOwnedLegacyKeys(platform);
            migrationReport = {
                namespaceEntries,
                legacyEntries: legacy.migrated,
                quarantinedLegacyEntries: legacy.quarantined,
            };
            return migrationReport;
        },
        getMigrationReport() {
            return migrationReport;
        },
    };
}
