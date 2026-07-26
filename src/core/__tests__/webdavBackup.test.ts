const mockConfigValues = new Map<string, unknown>();
const mockPersistValues = new Map<string, unknown>();
const mockGetCredential = jest.fn();
const mockHasCredential = jest.fn();
const mockCreateClient = jest.fn();
const mockClient = {
    exists: jest.fn(),
    createDirectory: jest.fn(),
    getDirectoryContents: jest.fn(),
    deleteFile: jest.fn(),
    putFileContents: jest.fn(),
    getFileContents: jest.fn(),
};

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: (key: string) => mockConfigValues.get(key),
    },
}));

jest.mock("@/native/secureCredential", () => ({
    __esModule: true,
    default: {
        getCredential: (...args: unknown[]) => mockGetCredential(...args),
        hasCredential: (...args: unknown[]) => mockHasCredential(...args),
    },
    webdavPasswordCredentialKey: "webdav.password",
}));

jest.mock("../pluginManager/webdavRuntime", () => ({
    webdavRuntime: {
        AuthType: { Password: "password" },
        createClient: (...args: unknown[]) => mockCreateClient(...args),
    },
}));

jest.mock("../pluginManager/restrictedWebdav", () => ({
    createRestrictedWebdavFacade: (webdavModule: {
        AuthType: Record<string, unknown>;
        createClient: (...args: unknown[]) => unknown;
    }) => ({
        AuthType: webdavModule.AuthType,
        createClient: (
            url: string,
            clientOptions: Record<string, unknown>,
        ) => webdavModule.createClient(url, clientOptions),
    }),
}));

jest.mock("@/core/backup", () => ({
    __esModule: true,
    default: {
        backup: () => "{}",
    },
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
    trace: jest.fn(),
}));

jest.mock("@/utils/network", () => ({
    __esModule: true,
    default: { isWifi: true },
}));

jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: {
        get: (key: string) => mockPersistValues.get(key),
        set: (key: string, value: unknown) => {
            if (value === undefined) {
                mockPersistValues.delete(key);
            } else {
                mockPersistValues.set(key, value);
            }
        },
    },
}));

import {
    backupToWebdav,
    hasConfiguredWebdav,
    maybeRunAutoWebdavBackup,
} from "../webdavBackup";

describe("WebDAV secure credential integration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigValues.clear();
        mockPersistValues.clear();
        mockCreateClient.mockReturnValue(mockClient);
        mockClient.exists.mockResolvedValue(false);
        mockClient.createDirectory.mockResolvedValue(undefined);
        mockClient.getDirectoryContents.mockResolvedValue([]);
        mockClient.deleteFile.mockResolvedValue(undefined);
        mockClient.putFileContents.mockResolvedValue(undefined);
        mockClient.getFileContents.mockResolvedValue("{}");
        mockGetCredential.mockResolvedValue("secret");
        mockHasCredential.mockResolvedValue(true);
    });

    function configureWebdav() {
        mockConfigValues.set(
            "webdav.url",
            "https://dav.example.com/root",
        );
        mockConfigValues.set("webdav.username", "user");
    }

    it("treats a new installation without a credential as incomplete", async () => {
        mockHasCredential.mockResolvedValue(false);

        await expect(hasConfiguredWebdav()).resolves.toBe(false);
        expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("reads the password only from secure storage when connecting", async () => {
        configureWebdav();

        await expect(backupToWebdav("{}")).resolves.toMatchObject({
            latestPath: "/MusicFree/MusicFreeBackup.json",
        });

        expect(mockGetCredential).toHaveBeenCalledWith("webdav.password");
        expect(mockCreateClient).toHaveBeenCalledWith(
            "https://dav.example.com/root",
            expect.objectContaining({
                authType: "password",
                username: "user",
                password: "secret",
            }),
        );
        expect(mockConfigValues.has("webdav.password")).toBe(false);
    });

    it("connects to an explicitly stored HTTP endpoint", async () => {
        configureWebdav();
        mockConfigValues.set("webdav.url", "http://nas.local/root");

        await expect(backupToWebdav("{}")).resolves.toMatchObject({
            latestPath: "/MusicFree/MusicFreeBackup.json",
        });
        expect(mockCreateClient).toHaveBeenCalledWith(
            "http://nas.local/root",
            expect.objectContaining({
                username: "user",
                password: "secret",
            }),
        );
    });

    it("fails closed when the Keychain/Keystore item is lost", async () => {
        configureWebdav();
        mockGetCredential.mockResolvedValue(null);

        await expect(backupToWebdav("{}")).rejects.toThrow("incomplete");
        expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("leaves auto backup idle after credentials are cleared", async () => {
        configureWebdav();
        mockConfigValues.set("webdav.autoBackupInterval", "daily");
        mockHasCredential.mockResolvedValue(false);

        await expect(maybeRunAutoWebdavBackup()).resolves.toBe(false);
        expect(mockGetCredential).not.toHaveBeenCalled();
        expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("stores only a redacted auto-backup error", async () => {
        configureWebdav();
        mockConfigValues.set("webdav.autoBackupInterval", "daily");
        mockClient.exists.mockRejectedValue(
            new Error(
                "https://dav.example.com/root?token=secret failed",
            ),
        );

        await expect(maybeRunAutoWebdavBackup()).resolves.toBe(false);
        const storedError = String(
            mockPersistValues.get("backup.webdavAutoBackupLastError"),
        );
        expect(storedError).not.toContain("dav.example.com");
        expect(storedError).not.toContain("secret");
        expect(storedError).toContain("[url]");
    });
});
