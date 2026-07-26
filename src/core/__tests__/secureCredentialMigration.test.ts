import {
    migrateLegacyWebdavCredential,
    type LegacyCredentialConfigStore,
} from "../secureCredentialMigration";
import type { ISecureCredentialStore } from "@/native/secureCredential";

function createConfigStore(
    password?: string,
): LegacyCredentialConfigStore & { values: Map<string, string> } {
    const values = new Map<string, string>();
    if (password !== undefined) {
        values.set("webdav.password", JSON.stringify(password));
    }
    return {
        values,
        getString: key => values.get(key),
        delete: key => {
            values.delete(key);
        },
    };
}

function createCredentialStore(): ISecureCredentialStore & {
    values: Map<string, string>;
    } {
    const values = new Map<string, string>();
    return {
        values,
        async setCredential(key, value) {
            values.set(key, value);
        },
        async getCredential(key) {
            return values.get(key) ?? null;
        },
        async hasCredential(key) {
            return values.has(key);
        },
        async deleteCredential(key) {
            values.delete(key);
        },
    };
}

describe("legacy WebDAV credential migration", () => {
    it("does nothing for a new installation", async () => {
        const config = createConfigStore();
        const credentials = createCredentialStore();

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).resolves.toBe("absent");
        expect(credentials.values.size).toBe(0);
    });

    it("writes, verifies, then deletes the plaintext value", async () => {
        const config = createConfigStore("secret");
        const credentials = createCredentialStore();

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).resolves.toBe("migrated");
        expect(credentials.values.get("webdav.password")).toBe("secret");
        expect(config.values.has("webdav.password")).toBe(false);
    });

    it("retains the legacy value when secure writing fails", async () => {
        const config = createConfigStore("recoverable");
        const credentials = createCredentialStore();
        credentials.setCredential = async () => {
            throw new Error("keystore unavailable");
        };

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).rejects.toThrow("keystore unavailable");
        expect(config.values.get("webdav.password")).toBe(
            JSON.stringify("recoverable"),
        );
    });

    it("retains the legacy value when read-back verification fails", async () => {
        const config = createConfigStore("recoverable");
        const credentials = createCredentialStore();
        credentials.getCredential = async () => "different";

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).rejects.toThrow("verification");
        expect(config.values.has("webdav.password")).toBe(true);
    });

    it("is idempotent when retried after a transient failure", async () => {
        const config = createConfigStore("secret");
        const credentials = createCredentialStore();
        const originalSet = credentials.setCredential;
        credentials.setCredential = jest.fn()
            .mockRejectedValueOnce(new Error("temporary"))
            .mockImplementation(originalSet);

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).rejects.toThrow("temporary");
        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).resolves.toBe("migrated");
        expect(config.values.has("webdav.password")).toBe(false);
        expect(credentials.values.get("webdav.password")).toBe("secret");
    });

    it("removes an empty legacy password from both stores", async () => {
        const config = createConfigStore("");
        const credentials = createCredentialStore();
        credentials.values.set("webdav.password", "stale");

        await expect(
            migrateLegacyWebdavCredential(config, credentials),
        ).resolves.toBe("empty-removed");
        expect(config.values.size).toBe(0);
        expect(credentials.values.size).toBe(0);
    });
});
