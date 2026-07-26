jest.mock("react-native", () => ({
    NativeModules: {},
}));

import SecureCredential, {
    setCredentialVerified,
} from "../index";

const { NativeModules: mockNativeModules } =
    jest.requireMock("react-native") as {
        NativeModules: Record<string, any>;
    };

describe("SecureCredential native wrapper", () => {
    beforeEach(() => {
        Object.keys(mockNativeModules).forEach(key => {
            delete mockNativeModules[key];
        });
    });

    it("fails closed when the native module is unavailable", async () => {
        await expect(
            SecureCredential.getCredential("webdav.password"),
        ).rejects.toThrow("unavailable");
    });

    it("writes and verifies a credential", async () => {
        const values = new Map<string, string>();
        mockNativeModules.SecureCredential = {
            setCredential: jest.fn(async (key, value) => {
                values.set(key, value);
            }),
            getCredential: jest.fn(async key => values.get(key) ?? null),
            hasCredential: jest.fn(async key => values.has(key)),
            deleteCredential: jest.fn(async key => {
                values.delete(key);
            }),
        };

        await expect(
            setCredentialVerified("webdav.password", "secret"),
        ).resolves.toBeUndefined();
        await expect(
            SecureCredential.hasCredential("webdav.password"),
        ).resolves.toBe(true);
        await SecureCredential.deleteCredential("webdav.password");
        await expect(
            SecureCredential.hasCredential("webdav.password"),
        ).resolves.toBe(false);
    });

    it("rejects a failed native read-back verification", async () => {
        mockNativeModules.SecureCredential = {
            setCredential: jest.fn(async () => undefined),
            getCredential: jest.fn(async () => "different"),
            hasCredential: jest.fn(async () => true),
            deleteCredential: jest.fn(async () => undefined),
        };

        await expect(
            setCredentialVerified("webdav.password", "expected"),
        ).rejects.toThrow("verification");
    });
});
