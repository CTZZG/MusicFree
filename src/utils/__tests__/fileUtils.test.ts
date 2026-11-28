const mockExists = jest.fn();
const mockUnlink = jest.fn();
const mockReadDir = jest.fn();
const mockClearDiskCache = jest.fn();

jest.mock("react-native-fs", () => ({
    __esModule: true,
    default: {},
    PicturesDirectoryPath: "/pictures",
    copyFile: jest.fn(),
    downloadFile: jest.fn(),
    exists: (...args: any[]) => mockExists(...args),
    mkdir: jest.fn(),
    readDir: (...args: any[]) => mockReadDir(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
    writeFile: jest.fn(),
}));
jest.mock("expo-image", () => ({
    __esModule: true,
    Image: { clearDiskCache: () => mockClearDiskCache() },
}));
jest.mock("@/constants/pathConst", () => ({
    __esModule: true,
    default: {
        basePath: "/app",
        musicCachePath: "/cache/TrackPlayer",
        lrcCachePath: "/app/cache/lrc/",
        imageCachePath: "/cache/image_manager_disk_cache",
    },
}));
jest.mock("../log", () => ({
    errorLog: jest.fn(),
}));

import { clearCache, getCacheSize, setProtectedExternalImportPathsProvider } from "../fileUtils";

describe("fileUtils music cache & external imports cleanup", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setProtectedExternalImportPathsProvider(null);
    });

    it("clearCache('music') removes both track cache and external imports directory", async () => {
        mockExists.mockResolvedValue(true);
        mockUnlink.mockResolvedValue(undefined);

        await clearCache("music");

        expect(mockUnlink).toHaveBeenCalledWith("/cache/TrackPlayer");
        expect(mockUnlink).toHaveBeenCalledWith("/app/imports");
    });

    it("only counts and removes orphan imports in nested directories", async () => {
        setProtectedExternalImportPathsProvider(() => ["file:///app/imports/nested/./active.mp3"]);
        const asFile = (path: string, size: number) => ({ path, size, isFile: () => true, isDirectory: () => false });
        mockReadDir.mockImplementation(async (dir: string) => {
            if (dir === "/app/imports") {
                return [{ path: "/app/imports/nested", isFile: () => false, isDirectory: () => true }];
            }
            if (dir === "/app/imports/nested") {
                return [asFile(`${dir}/active.mp3`, 120), asFile(`${dir}/orphan.mp3`, 80)];
            }
            return [];
        });
        await expect(getCacheSize("music")).resolves.toBe(80);
        await clearCache("music");
        expect(mockUnlink.mock.calls).toEqual([["/cache/TrackPlayer"], ["/app/imports/nested/orphan.mp3"]]);
    });

    it("getCacheSize('music') includes temporary external imports", async () => {
        mockReadDir.mockImplementation(async (dir: string) => {
            if (dir === "/cache/TrackPlayer") {
                return [{ isFile: () => true, isDirectory: () => false, size: 120 }];
            }
            if (dir === "/app/imports") {
                return [{ isFile: () => true, isDirectory: () => false, size: 80 }];
            }
            return [];
        });

        await expect(getCacheSize("music")).resolves.toBe(200);
    });
});
