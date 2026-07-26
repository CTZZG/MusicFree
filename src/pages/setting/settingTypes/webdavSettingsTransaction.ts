import {
    requiresWebdavHttpConfirmation,
    validateWebdavUrl,
} from "@/core/webdavUrl";

type WebdavConfigKey = "webdav.url" | "webdav.username";

export interface WebdavSettingsValues {
    password?: string;
    url?: string;
    username?: string;
}

export interface WebdavSettingsTransactionDeps {
    currentUrl?: string;
    deletePassword(): Promise<void>;
    hasStoredPassword: boolean;
    onSuccess?(): void;
    setConfig(key: WebdavConfigKey, value: string | undefined): void;
    setPassword(password: string): Promise<void>;
}

export type WebdavSettingsTransaction =
    | {
        kind: "invalid";
        reason: string;
    }
    | {
        commit(): Promise<void>;
        kind: "commit";
        requiresHttpConfirmation: boolean;
    };

function onceAsync(action: () => Promise<void>) {
    let inFlight: Promise<void> | undefined;
    return async () => {
        if (!inFlight) {
            inFlight = action().catch(error => {
                inFlight = undefined;
                throw error;
            });
        }
        return inFlight;
    };
}

export function createWebdavSettingsTransaction(
    values: WebdavSettingsValues | undefined,
    deps: WebdavSettingsTransactionDeps,
): WebdavSettingsTransaction {
    const rawUrl = values?.url?.trim() ?? "";
    const username = values?.username?.trim() ?? "";
    const password = values?.password ?? "";

    if (!rawUrl && !username && !password) {
        return {
            kind: "commit",
            requiresHttpConfirmation: false,
            commit: onceAsync(async () => {
                await deps.deletePassword();
                deps.setConfig("webdav.url", undefined);
                deps.setConfig("webdav.username", undefined);
                deps.onSuccess?.();
            }),
        };
    }

    const validation = validateWebdavUrl(rawUrl);
    if (!validation.ok) {
        return {
            kind: "invalid",
            reason: validation.reason,
        };
    }
    if (!username || (!password && !deps.hasStoredPassword)) {
        return {
            kind: "invalid",
            reason: "incomplete",
        };
    }

    return {
        kind: "commit",
        requiresHttpConfirmation: requiresWebdavHttpConfirmation(
            deps.currentUrl,
            validation.url,
        ),
        commit: onceAsync(async () => {
            if (password) {
                await deps.setPassword(password);
            }
            deps.setConfig("webdav.url", validation.url);
            deps.setConfig("webdav.username", username);
            deps.onSuccess?.();
        }),
    };
}
