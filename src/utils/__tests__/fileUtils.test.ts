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

import { clearCache, getCacheSize } from "../fileUtils";

describe("fileUtils music cache & external imports cleanup", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("clearCache('music') removes both track cache and external imports directory", async () => {
        mockExists.mockResolvedValue(true);
        mockUnlink.mockResolvedValue(undefined);

        await clearCache("music");

        expect(mockUnlink).toHaveBeenCalledWith("/cache/TrackPlayer");
        expect(mockUnlink).toHaveBeenCalledWith("/app/imports");
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
