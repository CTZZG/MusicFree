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

import {
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
    beforeEach(() => resetMusicDetailArtworkCacheForTests());

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
});
