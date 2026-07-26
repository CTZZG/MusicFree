jest.mock("react-native-fs", () => ({
    __esModule: true,
    CachesDirectoryPath: "/cache",
    default: {
        DocumentDirectoryPath: "/documents",
        ExternalDirectoryPath: "/external",
    },
}));

jest.mock("@/utils/fileUtils", () => ({
    checkAndCreateDir: jest.fn(() => Promise.resolve()),
}));

import pathConst from "@/constants/pathConst";
import { setupAppFolders } from "../setupFolders";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

describe("setupAppFolders", () => {
    it("waits for the download parent before creating and awaiting its child", async () => {
        const downloadParent = deferred();
        const downloadChild = deferred();
        const ensureDirectory = jest.fn((path: string) => {
            if (path === pathConst.downloadPath) {
                return downloadParent.promise;
            }
            if (path === pathConst.downloadMusicPath) {
                return downloadChild.promise;
            }
            return Promise.resolve();
        });

        let completed = false;
        const setup = setupAppFolders(ensureDirectory).then(() => {
            completed = true;
        });
        await Promise.resolve();

        expect(ensureDirectory).not.toHaveBeenCalledWith(
            pathConst.downloadMusicPath,
        );
        downloadParent.resolve();
        await Promise.resolve();
        expect(ensureDirectory).toHaveBeenCalledWith(
            pathConst.downloadMusicPath,
        );
        expect(completed).toBe(false);

        downloadChild.resolve();
        await setup;
        expect(completed).toBe(true);
    });

    it("rejects when a required directory cannot be created", async () => {
        const failure = new Error("mkdir failed");
        const ensureDirectory = jest.fn((path: string) =>
            path === pathConst.cachePath
                ? Promise.reject(failure)
                : Promise.resolve(),
        );

        await expect(setupAppFolders(ensureDirectory)).rejects.toBe(failure);
    });
});
