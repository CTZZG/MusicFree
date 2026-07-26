jest.mock("react-native", () => ({
    NativeModules: {},
    Platform: { OS: "android" },
}));

import StorageUri from "../index";

const { NativeModules: mockNativeModules } =
    jest.requireMock("react-native") as {
        NativeModules: Record<string, any>;
    };

describe("StorageUri native wrapper", () => {
    beforeEach(() => {
        Object.keys(mockNativeModules).forEach(key => {
            delete mockNativeModules[key];
        });
    });

    it("fails closed when the native module is unavailable", async () => {
        await expect(StorageUri.exists("content://provider/item")).rejects.toThrow(
            "unavailable",
        );
    });

    it("forwards content operations without converting the URI to a path", async () => {
        const exists = jest.fn(async () => true);
        const copyToApp = jest.fn(async () => undefined);
        const requestWriteAccess = jest.fn(async () => true);
        mockNativeModules.StorageUri = {
            exists,
            copyToApp,
            requestWriteAccess,
        };

        await expect(
            StorageUri.exists("content://provider/item"),
        ).resolves.toBe(true);
        await StorageUri.copyToApp(
            "content://provider/item",
            "/data/user/0/app/files/item",
        );
        expect(exists).toHaveBeenCalledWith("content://provider/item");
        expect(copyToApp).toHaveBeenCalledWith(
            "content://provider/item",
            "/data/user/0/app/files/item",
        );
        await expect(
            StorageUri.requestWriteAccess("content://provider/item"),
        ).resolves.toBe(true);
        expect(requestWriteAccess).toHaveBeenCalledWith(
            "content://provider/item",
        );
    });

    it("forwards persisted directory selection, listing, and cancellation", async () => {
        const selectedDirectory = {
            uri: "content://provider/tree/music",
            kind: "content-uri",
            exists: true,
            displayName: "Music",
            mimeType: null,
            size: null,
            persisted: true,
        };
        const documents = [
            {
                ...selectedDirectory,
                uri: "content://provider/document/music%2Ftrack.dsf",
                displayName: "track.dsf",
                mimeType: "audio/x-dsf",
                size: 1024,
            },
        ];
        const pickDirectory = jest.fn(async () => selectedDirectory);
        const listDirectoryDocuments = jest.fn(async () => documents);
        const cancelDirectoryScan = jest.fn();
        mockNativeModules.StorageUri = {
            pickDirectory,
            listDirectoryDocuments,
            cancelDirectoryScan,
        };

        await expect(StorageUri.pickDirectory()).resolves.toEqual(
            selectedDirectory,
        );
        await expect(
            StorageUri.listDirectoryDocuments(
                selectedDirectory.uri,
                [".dsf", ".asf"],
            ),
        ).resolves.toEqual(documents);
        StorageUri.cancelDirectoryScan();

        expect(pickDirectory).toHaveBeenCalledTimes(1);
        expect(listDirectoryDocuments).toHaveBeenCalledWith(
            selectedDirectory.uri,
            [".dsf", ".asf"],
        );
        expect(cancelDirectoryScan).toHaveBeenCalledTimes(1);
    });
});
