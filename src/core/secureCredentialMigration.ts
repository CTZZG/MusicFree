import type { ISecureCredentialStore } from "@/native/secureCredential";
import { webdavPasswordCredentialKey } from "@/native/secureCredential";

export interface LegacyCredentialConfigStore {
    getString(key: string): string | undefined;
    delete(key: string): void;
}

export type SecureCredentialMigrationResult =
    | "absent"
    | "empty-removed"
    | "migrated";

function parseLegacyPassword(rawValue: string) {
    let value: unknown;
    try {
        value = JSON.parse(rawValue);
    } catch {
        throw new Error("Legacy WebDAV credential is corrupted");
    }
    if (typeof value !== "string") {
        throw new Error("Legacy WebDAV credential has an invalid type");
    }
    return value;
}

export async function migrateLegacyWebdavCredential(
    configStore: LegacyCredentialConfigStore,
    credentialStore: ISecureCredentialStore,
): Promise<SecureCredentialMigrationResult> {
    const rawPassword = configStore.getString(
        webdavPasswordCredentialKey,
    );
    if (rawPassword === undefined) {
        return "absent";
    }

    const password = parseLegacyPassword(rawPassword);
    if (!password) {
        await credentialStore.deleteCredential(
            webdavPasswordCredentialKey,
        );
        configStore.delete(webdavPasswordCredentialKey);
        return "empty-removed";
    }

    await credentialStore.setCredential(
        webdavPasswordCredentialKey,
        password,
    );
    const verified = await credentialStore.getCredential(
        webdavPasswordCredentialKey,
    );
    if (verified !== password) {
        throw new Error("Secure WebDAV credential verification failed");
    }

    configStore.delete(webdavPasswordCredentialKey);
    return "migrated";
}
