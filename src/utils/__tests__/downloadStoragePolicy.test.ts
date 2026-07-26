import { resolveDownloadDirectory } from "../downloadStoragePolicy";

describe("downloadStoragePolicy", () => {
    const options = {
        appScopedRoot: "/storage/emulated/0/Android/data/app/files",
        fallbackPath:
            "/storage/emulated/0/Android/data/app/files/download/music",
    };

    it("keeps Android downloads inside app-scoped storage", () => {
        expect(
            resolveDownloadDirectory({
                ...options,
                platform: "android",
                configuredPath: "/storage/emulated/0/Music",
            }),
        ).toBe(options.fallbackPath);
        expect(
            resolveDownloadDirectory({
                ...options,
                platform: "android",
                configuredPath:
                    "/storage/emulated/0/Android/data/app/files/custom",
            }),
        ).toBe(
            "/storage/emulated/0/Android/data/app/files/custom",
        );
    });

    it("retains the existing configurable behavior on other platforms", () => {
        expect(
            resolveDownloadDirectory({
                ...options,
                platform: "ios",
                configuredPath: "/Documents/Music",
            }),
        ).toBe("/Documents/Music");
    });
});

