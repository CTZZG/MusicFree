jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getByMedia: jest.fn(() => undefined),
    },
}));

jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: (item: ICommon.IMediaBase) =>
        `${item.platform}@${item.id}`,
}));

const mockRestrictedGet = jest.fn();
jest.mock("@/utils/restrictedHttpClient", () => ({
    createRestrictedHttpClient: () => ({
        get: (...args: unknown[]) => mockRestrictedGet(...args),
    }),
}));

import {
    getCachedMusicArtwork,
    isUsableMusicDetailArtwork,
    resetMusicDetailArtworkCacheForTests,
    resolveMusicDetailArtwork,
} from "../artworkResolver";

function music(overrides: Partial<IMusic.IMusicItem> = {}) {
    return {
        id: "song-1",
        platform: "test",
        title: "想得美",
        artist: "TOP登陆少年组合",
        album: "想得美",
        duration: 180,
        artwork: "",
        ...overrides,
    } as IMusic.IMusicItem;
}

describe("music detail artwork resolver", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetMusicDetailArtworkCacheForTests();
    });

    it("uses existing artwork without starting a network lookup", async () => {
        const getMusicInfo = jest.fn();
        await expect(
            resolveMusicDetailArtwork(
                music({ artwork: "https://img/existing.jpg" }),
                { getMusicInfo },
            ),
        ).resolves.toBe("https://img/existing.jpg");
        expect(getMusicInfo).not.toHaveBeenCalled();
    });

    it("does not trust an unsupported artwork URI scheme", async () => {
        const getMusicInfo = jest.fn(async () => ({
            artwork: "https://img/safe.jpg",
        }));
        await expect(
            resolveMusicDetailArtwork(music({ artwork: "javascript:alert(1)" }), {
                getMusicInfo,
            }),
        ).resolves.toBe("https://img/safe.jpg");
        expect(getMusicInfo).toHaveBeenCalledTimes(1);
    });

    it("rejects credentialed and private remote artwork", () => {
        expect(
            isUsableMusicDetailArtwork(
                "https://user:secret@images.example/cover.jpg",
            ),
        ).toBe(false);
        expect(isUsableMusicDetailArtwork("https://127.0.0.1/cover.jpg"))
            .toBe(false);
        expect(isUsableMusicDetailArtwork("http://10.1.2.3/cover.jpg"))
            .toBe(false);
        expect(isUsableMusicDetailArtwork("content://media/cover/1"))
            .toBe(true);
    });

    // 明文 http 封面来源很常见（酷我等），拒绝它只会让详情页退回占位图。
    // 详见 utils/artworkSourcePolicy.ts 里的说明。
    it("accepts public cleartext remote artwork", () => {
        expect(isUsableMusicDetailArtwork("http://images.example/cover.jpg"))
            .toBe(true);
    });

    it("deduplicates detail lookups and caches the successful result", async () => {
        const getMusicInfo = jest.fn(async () => ({
            artwork: "https://img/detail.jpg",
        }));
        const item = music();

        await expect(
            Promise.all([
                resolveMusicDetailArtwork(item, { getMusicInfo }),
                resolveMusicDetailArtwork(item, { getMusicInfo }),
            ]),
        ).resolves.toEqual([
            "https://img/detail.jpg",
            "https://img/detail.jpg",
        ]);
        await expect(
            resolveMusicDetailArtwork(item, { getMusicInfo }),
        ).resolves.toBe("https://img/detail.jpg");
        expect(getMusicInfo).toHaveBeenCalledTimes(1);
    });

    it("exposes a resolved cover to other visible UI consumers", async () => {
        const item = music();
        await resolveMusicDetailArtwork(item, {
            getMusicInfo: jest.fn(async () => ({
                artwork: "https://img/shared.jpg",
            })),
        });

        expect(getCachedMusicArtwork(item)).toBe("https://img/shared.jpg");
    });

    it("does not reuse a cached cover when a plugin reuses an id for another song", async () => {
        const getMusicInfo = jest.fn(async (item: IMusic.IMusicItem) => ({
            artwork: `https://img/${item.title}.jpg`,
        }));

        await expect(
            resolveMusicDetailArtwork(music(), { getMusicInfo }),
        ).resolves.toBe("https://img/想得美.jpg");
        await expect(
            resolveMusicDetailArtwork(
                music({ title: "你要的全拿走", album: "你要的全拿走" }),
                { getMusicInfo },
            ),
        ).resolves.toBe("https://img/你要的全拿走.jpg");
        expect(getMusicInfo).toHaveBeenCalledTimes(2);
    });

    it("accepts only an exact title and compatible artist from search", async () => {
        const search = jest.fn(async () => [
            music({
                id: "wrong-artist",
                artist: "其他歌手",
                artwork: "https://img/wrong.jpg",
            }),
            music({
                id: "match",
                artwork: "https://img/match.jpg",
            }),
        ]);

        await expect(
            resolveMusicDetailArtwork(music(), { search }),
        ).resolves.toBe("https://img/match.jpg");
    });

    it("accepts an exact result when local title and artist tags are swapped", async () => {
        const search = jest.fn(async () => [
            music({
                id: "itunes-match",
                title: "Back In My Life",
                artist: "Alice Deejay",
                artwork: "https://img/back-in-my-life.jpg",
            }),
        ]);

        await expect(
            resolveMusicDetailArtwork(
                music({ title: "Alice Deejay", artist: "Back In My Life" }),
                { search },
            ),
        ).resolves.toBe("https://img/back-in-my-life.jpg");
    });

    it("does not use a similarly named song as a cover fallback", async () => {
        const search = jest.fn(async () => [
            music({
                title: "想得美 Remix",
                artwork: "https://img/remix.jpg",
            }),
        ]);

        await expect(
            resolveMusicDetailArtwork(music(), { search }),
        ).resolves.toBeUndefined();
    });

    it("rejects a title-only result when the requested song has an artist", async () => {
        const search = jest.fn(async () => [
            music({ artist: "", artwork: "https://img/unknown-artist.jpg" }),
        ]);

        await expect(
            resolveMusicDetailArtwork(music(), { search }),
        ).resolves.toBeUndefined();
    });

    it("turns synchronous plugin failures into a cached fallback", async () => {
        const getMusicInfo = jest.fn(() => {
            throw new Error("plugin failed synchronously");
        });
        const item = music();

        await expect(
            resolveMusicDetailArtwork(item, { getMusicInfo }),
        ).resolves.toBeUndefined();
        await expect(
            resolveMusicDetailArtwork(item, { getMusicInfo }),
        ).resolves.toBeUndefined();
        expect(getMusicInfo).toHaveBeenCalledTimes(1);
    });

    it("uses a high-resolution iTunes album cover when plugins have no artwork", async () => {
        mockRestrictedGet.mockResolvedValue({
            data: {
                results: [
                    {
                        trackId: 123,
                        trackName: "Back In My Life",
                        artistName: "Alice Deejay",
                        collectionName: "Back In My Life",
                        artworkUrl100:
                            "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
                    },
                ],
            },
        });

        await expect(
            resolveMusicDetailArtwork(
                music({
                    title: "Alice Deejay",
                    artist: "Back In My Life",
                }),
            ),
        ).resolves.toBe(
            "https://is1-ssl.mzstatic.com/image/1200x1200bb.jpg",
        );
        expect(mockRestrictedGet).toHaveBeenCalledWith(
            expect.stringContaining(
                "term=Alice%20Deejay%20Back%20In%20My%20Life",
            ),
            expect.objectContaining({
                timeout: 3_200,
            }),
        );
    });

    it("drops an unsafe artwork URL returned by iTunes", async () => {
        mockRestrictedGet.mockResolvedValue({
            data: {
                results: [
                    {
                        trackId: 123,
                        trackName: "Back In My Life",
                        artistName: "Alice Deejay",
                        artworkUrl100: "https://127.0.0.1/100x100bb.jpg",
                    },
                ],
            },
        });

        await expect(
            resolveMusicDetailArtwork(
                music({
                    title: "Back In My Life",
                    artist: "Alice Deejay",
                }),
            ),
        ).resolves.toBeUndefined();
    });
});
