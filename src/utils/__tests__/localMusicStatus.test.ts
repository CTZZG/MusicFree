import {
    findLocalMusicItem,
    resolveLocalFileCheckItem,
} from "../localMusicStatus";

const remoteMusic = {
    platform: "netease",
    id: "1001",
    title: "Remote title",
};

const localMusic = {
    platform: "netease",
    id: "1001",
    title: "Local title",
    url: "file:///music/1001.flac",
};

describe("localMusicStatus", () => {
    it("finds a downloaded local item by media identity", () => {
        expect(findLocalMusicItem([localMusic], remoteMusic)).toBe(localMusic);
    });

    it("does not match a different media identity", () => {
        expect(
            findLocalMusicItem([localMusic], {
                platform: "netease",
                id: "1002",
            }),
        ).toBeUndefined();
    });

    it("uses the local copy for file checks when one exists", () => {
        expect(resolveLocalFileCheckItem([localMusic], remoteMusic)).toBe(
            localMusic,
        );
    });

    it("falls back to the original item when no local copy exists", () => {
        expect(resolveLocalFileCheckItem([], remoteMusic)).toBe(remoteMusic);
    });
});
