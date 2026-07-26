import { NativeModules } from "react-native";

export const webdavPasswordCredentialKey = "webdav.password";

export interface ISecureCredentialStore {
    setCredential(key: string, value: string): Promise<void>;
    getCredential(key: string): Promise<string | null>;
    hasCredential(key: string): Promise<boolean>;
    deleteCredential(key: string): Promise<void>;
}

interface ISecureCredentialNativeModule {
    setCredential(key: string, value: string): Promise<void>;
    getCredential(key: string): Promise<string | null>;
    hasCredential(key: string): Promise<boolean>;
    deleteCredential(key: string): Promise<void>;
}

function getNativeModule(): ISecureCredentialNativeModule {
    const nativeModule = NativeModules.SecureCredential as
        | ISecureCredentialNativeModule
        | undefined;
    if (!nativeModule) {
        throw new Error("Secure credential storage is unavailable");
    }
    return nativeModule;
}

const SecureCredential: ISecureCredentialStore = {
    async setCredential(key, value) {
        await getNativeModule().setCredential(key, value);
    },
    async getCredential(key) {
        const value = await getNativeModule().getCredential(key);
        if (value !== null && typeof value !== "string") {
            throw new Error("Secure credential storage returned invalid data");
        }
        return value;
    },
    async hasCredential(key) {
        return Boolean(await getNativeModule().hasCredential(key));
    },
    async deleteCredential(key) {
        await getNativeModule().deleteCredential(key);
    },
};

export async function setCredentialVerified(key: string, value: string) {
    await SecureCredential.setCredential(key, value);
    if (await SecureCredential.getCredential(key) !== value) {
        throw new Error("Secure credential verification failed");
    }
}

export default SecureCredential;
