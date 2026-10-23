import {
    AUTO_LIBRARY_LIST_LIMIT,
    createAutoLibrary,
    encodeAutoLibraryItemId,
    parseAutoLibraryMediaId,
} from "../androidAutoLibrary";

const song = (id: string, extra: Partial<IMusic.IMusicItem> = {}): IMusic.IMusicItem => ({
    platform: "测试源",
    id,
    title: `歌 ${id}`,
    artist: "歌手",
    album: "专辑",
    artwork: `https://img.example/${id}.jpg`,
    ...extra,
} as IMusic.IMusicItem);

function setup(lists: { favorite?: IMusic.IMusicItem[]; recent?: IMusic.IMusicItem[] } = {}) {
    const provide = jest.fn(async () => undefined);
    const play = jest.fn(async () => undefined);
    const library = createAutoLibrary({
        sources: {
            favorite: () => lists.favorite ?? [],
            recent: () => lists.recent ?? [],
        },
        provide,
        play,
    });
    return { library, provide, play };
}

describe("Android Auto library media IDs", () => {
    it("round-trips song keys that contain slashes, percent signs and Chinese", () => {
        const tricky = song("a/b%2Fc 中文");
        const id = encodeAutoLibraryItemId("favorite", tricky);
        expect(id.startsWith("library/favorite/")).toBe(true);
        expect(id.slice("library/favorite/".length)).not.toContain("/");
        expect(parseAutoLibraryMediaId(id)).toEqual({
            listId: "favorite",
            key: "测试源@a/b%2Fc 中文",
        });
    });

    it("recognises the lists themselves and rejects anything else", () => {
        expect(parseAutoLibraryMediaId("library/recent")).toEqual({ listId: "recent" });
        expect(parseAutoLibraryMediaId("library/unknown/x")).toBeNull();
        expect(parseAutoLibraryMediaId("library/favorite/")).toBeNull();
        expect(parseAutoLibraryMediaId("library/favorite/%E0%A4%A")).toBeNull();
        expect(parseAutoLibraryMediaId("测试源@1")).toBeNull();
    });
});

describe("Android Auto library", () => {
    it("answers a list request with the current songs, capped for the car screen", async () => {
        const favorites = Array.from({ length: AUTO_LIBRARY_LIST_LIMIT + 5 }, (_, i) => song(String(i)));
        const { library, provide } = setup({ favorite: favorites });

        await library.handleBrowseRequest("library/favorite");

        const [parentId, items] = (provide.mock.calls as any[])[0];
        expect(parentId).toBe("library/favorite");
        expect(items).toHaveLength(AUTO_LIBRARY_LIST_LIMIT);
        expect(items[0]).toEqual({
            id: encodeAutoLibraryItemId("favorite", favorites[0]),
            title: "歌 0",
            artist: "歌手",
            album: "专辑",
            artwork: "https://img.example/0.jpg",
        });
    });

    it("still answers, with nothing, when the list is unknown or cannot be read", async () => {
        const provide = jest.fn(async () => undefined);
        const library = createAutoLibrary({
            sources: {
                favorite: () => {
                    throw new Error("not loaded yet");
                },
                recent: () => [],
            },
            provide,
            play: jest.fn(),
        });

        await library.handleBrowseRequest("library/favorite");
        await library.handleBrowseRequest("library/nope");
        await library.handleBrowseRequest("library/recent/测试源%401");

        expect(provide.mock.calls).toEqual([
            ["library/favorite", []],
            ["library/nope", []],
            ["library/recent/测试源%401", []],
        ]);
    });

    it("plays the picked song with the whole list as the new queue", async () => {
        const recent = [song("1"), song("2"), song("3")];
        const { library, play } = setup({ recent });

        await expect(
            library.handlePlay(encodeAutoLibraryItemId("recent", recent[1])),
        ).resolves.toBe(true);

        expect(play).toHaveBeenCalledWith(recent[1], recent);
    });

    it("does nothing for a song that left the list, and ignores IDs that are not its own", async () => {
        const favorites = [song("1")];
        const { library, play } = setup({ favorite: favorites });

        await expect(
            library.handlePlay(encodeAutoLibraryItemId("favorite", song("gone"))),
        ).resolves.toBe(true);
        await expect(library.handlePlay("测试源@1")).resolves.toBe(false);
        await expect(library.handlePlay("library/favorite")).resolves.toBe(false);

        expect(play).not.toHaveBeenCalled();
    });
});
