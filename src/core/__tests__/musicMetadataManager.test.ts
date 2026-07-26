jest.mock("@/native/mp3Util", () => {
    const native = {
        setMediaTag: jest.fn(),
        setMediaCover: jest.fn(),
        setMediaTagWithCover: jest.fn(),
        getMediaTag: jest.fn(),
    };
    return {
        __esModule: true,
        default: native,
        isMp3UtilNativeMethodAvailable: jest.fn(() => true),
    };
});

jest.mock("@/native/storageUri", () => ({
    __esModule: true,
    default: {
        requestWriteAccess: jest.fn(),
    },
}));

jest.mock("@/utils/fileUtils", () => ({
    removeFileScheme: (value: string) => value.replace(/^file:\/\//, ""),
}));

jest.mock("@/utils/musicDecrypter", () => ({
    autoDecryptLyric: jest.fn(async (value: string) => value),
}));

jest.mock("@/utils/lrcParser", () => ({
    formatLyricsByTimestamp: jest.fn((rawLrc: string) => rawLrc),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

import Mp3Util from "@/native/mp3Util";
import StorageUri from "@/native/storageUri";
import { autoDecryptLyric } from "@/utils/musicDecrypter";
import type { IDownloadMetadataConfig } from "@/types/metadata";
import { MusicMetadataManager } from "../musicMetadataManager";

const config: IDownloadMetadataConfig = {
    enabled: true,
    writeCover: true,
    writeLyric: true,
    fetchExtendedInfo: false,
    lyricOrder: ["original"],
    enableWordByWord: false,
    downloadLyricFile: true,
    lyricFileFormat: "lrc",
};

const musicItem = {
    id: "song-1",
    platform: "test",
    title: "Song One",
    artist: "Artist One",
    album: "Album One",
} as IMusic.IMusicItem;

function createPluginManager(plugin: any, searchablePlugins: any[] = []) {
    return {
        getByMedia: jest.fn(() => plugin),
        getSortedSearchablePlugins: jest.fn(() => searchablePlugins),
    } as any;
}

describe("MusicMetadataManager", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        jest.mocked(Mp3Util.setMediaTag).mockResolvedValue(true);
        jest.mocked(Mp3Util.setMediaTagWithCover!).mockResolvedValue(true);
        jest.mocked(StorageUri.requestWriteAccess).mockResolvedValue(true);
        jest.mocked(autoDecryptLyric).mockImplementation(async value => value);
        jest.mocked(Mp3Util.getMediaTag).mockResolvedValue({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
        });
    });

    it("reuses one enrichment for embedded metadata and sidecar consumers", async () => {
        const getLyric = jest.fn().mockResolvedValue({ rawLrc: "[00:00]Hi" });
        const getMusicInfo = jest
            .fn()
            .mockResolvedValue({ artwork: "https://example.test/cover.jpg" });
        const plugin = { methods: { getLyric, getMusicInfo } };
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 100,
            pluginCallTimeoutMs: 50,
        });
        manager.injectPluginManager(createPluginManager(plugin));

        const enrichment = await manager.getDownloadEnrichment(
            musicItem,
            config,
        );
        const success = await manager.writeMetadataForDownloadTask(
            { musicItem, filePath: "/tmp/song.mp3" },
            config,
            enrichment,
        );

        expect(success).toBe(true);
        expect(getLyric).toHaveBeenCalledTimes(1);
        expect(getMusicInfo).toHaveBeenCalledTimes(1);
        expect(enrichment.lyricContent).toBe("[00:00]Hi");
        expect(enrichment.coverUrl).toBe("https://example.test/cover.jpg");
    });


    it("lets the source plugin resolve an HTTP lrc reference", async () => {
        const getLyric = jest.fn().mockResolvedValue({
            rawLrc: "[00:00]Resolved by plugin",
        });
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 100,
            pluginCallTimeoutMs: 50,
        });
        manager.injectPluginManager(
            createPluginManager({ methods: { getLyric } }),
        );

        await expect(
            manager.getLyricContentForDownload(
                { ...musicItem, lrc: "https://example.test/song.lrc" },
                config,
            ),
        ).resolves.toBe("[00:00]Resolved by plugin");
        expect(getLyric).toHaveBeenCalledTimes(1);
    });

    it("uses an embedded lyric source without calling the plugin", async () => {
        const getLyric = jest.fn();
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 100,
            pluginCallTimeoutMs: 50,
        });
        manager.injectPluginManager(
            createPluginManager({ methods: { getLyric } }),
        );

        await expect(
            manager.getLyricContentForDownload(
                {
                    ...musicItem,
                    lyric: { rawLrc: "[00:00]Embedded lyric" },
                },
                config,
            ),
        ).resolves.toBe("[00:00]Embedded lyric");
        expect(getLyric).not.toHaveBeenCalled();
    });

    it("honors one total deadline across multiple non-resolving plugins", async () => {
        jest.useFakeTimers();
        const never = () => new Promise(() => {});
        const searchablePlugins = Array.from({ length: 3 }, () => ({
            methods: {
                search: jest.fn(never),
                getLyric: jest.fn(never),
            },
        }));
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 40,
            pluginCallTimeoutMs: 25,
        });
        manager.injectPluginManager(
            createPluginManager(undefined, searchablePlugins),
        );

        const enrichmentPromise = manager.getDownloadEnrichment(musicItem, {
            ...config,
            writeCover: false,
        });
        let settled = false;
        void enrichmentPromise.then(() => {
            settled = true;
        });

        await jest.advanceTimersByTimeAsync(39);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(2);
        await expect(enrichmentPromise).resolves.toEqual({
            lyricContent: undefined,
            coverUrl: undefined,
        });
        expect(
            searchablePlugins.reduce(
                (count, plugin) =>
                    count + plugin.methods.search.mock.calls.length,
                0,
            ),
        ).toBeLessThanOrEqual(2);
    });

    it("bounds direct lyric and cover calls that never settle", async () => {
        jest.useFakeTimers();
        const never = () => new Promise(() => {});
        const plugin = {
            methods: {
                getLyric: jest.fn(never),
                getMusicInfo: jest.fn(never),
            },
        };
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 40,
            pluginCallTimeoutMs: 100,
        });
        manager.injectPluginManager(createPluginManager(plugin));

        const enrichmentPromise = manager.getDownloadEnrichment(
            musicItem,
            config,
        );
        await jest.advanceTimersByTimeAsync(41);

        await expect(enrichmentPromise).resolves.toEqual({
            lyricContent: undefined,
            coverUrl: undefined,
        });
        expect(plugin.methods.getLyric).toHaveBeenCalledTimes(1);
        expect(plugin.methods.getMusicInfo).toHaveBeenCalledTimes(1);
    });

    it("bounds native lyric decryption that never settles", async () => {
        jest.useFakeTimers();
        jest.mocked(autoDecryptLyric).mockImplementation(
            () => new Promise(() => {}),
        );
        const plugin = {
            methods: {
                getLyric: jest.fn().mockResolvedValue({
                    rawLrc: "A".repeat(32),
                }),
            },
        };
        const manager = new MusicMetadataManager({
            enrichmentTimeoutMs: 40,
            pluginCallTimeoutMs: 100,
        });
        manager.injectPluginManager(createPluginManager(plugin));

        const enrichmentPromise = manager.getDownloadEnrichment(musicItem, {
            ...config,
            writeCover: false,
        });
        await jest.advanceTimersByTimeAsync(41);

        await expect(enrichmentPromise).resolves.toEqual({
            lyricContent: undefined,
            coverUrl: undefined,
        });
    });

    it("bounds a native metadata writer that never settles", async () => {
        jest.useFakeTimers();
        jest.mocked(Mp3Util.setMediaTag).mockImplementation(
            () => new Promise(() => {}),
        );
        const manager = new MusicMetadataManager({
            nativeMetadataTimeoutMs: 40,
        });
        manager.injectPluginManager(createPluginManager(undefined));

        const writePromise = manager.writeMetadataForDownloadTask(
            { musicItem, filePath: "/tmp/song.mp3" },
            { ...config, writeCover: false, writeLyric: false },
            {},
        );
        await jest.advanceTimersByTimeAsync(41);

        await expect(writePromise).resolves.toBe(false);
    });
    it("requires every populated key to match during native verification", async () => {
        const manager = new MusicMetadataManager({
            nativeMetadataTimeoutMs: 100,
        });
        manager.injectPluginManager(createPluginManager(undefined));
        jest.mocked(Mp3Util.getMediaTag).mockResolvedValue({
            title: musicItem.title,
            artist: "Wrong Artist",
            album: musicItem.album,
        });

        const success = await manager.writeMetadataForDownloadTask(
            { musicItem, filePath: "/tmp/song.mp3" },
            { ...config, writeCover: false, writeLyric: false },
            {},
        );

        expect(success).toBe(false);
    });

    it("requests platform consent before writing a content URI", async () => {
        const manager = new MusicMetadataManager({
            nativeMetadataTimeoutMs: 100,
        });
        manager.injectPluginManager(createPluginManager(undefined));
        const contentUri = "content://media/external/audio/media/42";

        await expect(
            manager.writeMetadataForDownloadTask(
                { musicItem, filePath: contentUri },
                { ...config, writeCover: false, writeLyric: false },
                {},
            ),
        ).resolves.toBe(true);

        expect(StorageUri.requestWriteAccess).toHaveBeenCalledWith(contentUri);
        expect(Mp3Util.setMediaTag).toHaveBeenCalledWith(
            contentUri,
            expect.objectContaining({ title: musicItem.title }),
        );
    });

    it("does not touch a content URI when write consent is denied", async () => {
        jest.mocked(StorageUri.requestWriteAccess).mockResolvedValue(false);
        const manager = new MusicMetadataManager({
            nativeMetadataTimeoutMs: 100,
        });
        manager.injectPluginManager(createPluginManager(undefined));

        await expect(
            manager.writeMetadataForDownloadTask(
                {
                    musicItem,
                    filePath: "content://media/external/audio/media/42",
                },
                { ...config, writeCover: false, writeLyric: false },
                {},
            ),
        ).resolves.toBe(false);
        expect(Mp3Util.setMediaTag).not.toHaveBeenCalled();
    });
});
