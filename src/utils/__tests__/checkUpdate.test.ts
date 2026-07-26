const mockGet = jest.fn();

jest.mock("react-native-device-info", () => ({
    __esModule: true,
    default: {
        getVersion: () => "1.0.0",
    },
}));

jest.mock("../restrictedHttpClient", () => ({
    createRestrictedHttpClient: () => ({
        get: (...args: unknown[]) => mockGet(...args),
    }),
}));

import checkUpdate from "../checkUpdate";

describe("checkUpdate network boundary", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("accepts a bounded public HTTPS update manifest", async () => {
        mockGet.mockResolvedValue({
            data: {
                version: "1.1.0",
                changeLog: ["fix"],
                download: ["https://downloads.example.com/app.apk"],
            },
        });

        await expect(checkUpdate()).resolves.toEqual({
            needUpdate: true,
            data: {
                version: "1.1.0",
                changeLog: ["fix"],
                download: ["https://downloads.example.com/app.apk"],
            },
        });
    });

    it("drops unsafe download links and tries the next manifest", async () => {
        mockGet
            .mockResolvedValueOnce({
                data: {
                    version: "1.1.0",
                    changeLog: ["unsafe"],
                    download: ["https://127.0.0.1/app.apk"],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    version: "1.1.0",
                    changeLog: ["safe"],
                    download: ["https://downloads.example.com/app.apk"],
                },
            });

        await expect(checkUpdate()).resolves.toMatchObject({
            data: {
                changeLog: ["safe"],
            },
        });
        expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it("rejects malformed manifests without exposing their fields", async () => {
        mockGet.mockResolvedValue({
            data: {
                version: 2,
                changeLog: "not-an-array",
                download: [["java", "script:alert(1)"].join("")],
            },
        });

        await expect(checkUpdate()).resolves.toBeUndefined();
        expect(mockGet).toHaveBeenCalledTimes(4);
    });
});
