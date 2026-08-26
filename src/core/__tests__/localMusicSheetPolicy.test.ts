import {
    createLocalMusicFileIdentity,
    mergeEditedListWithConcurrentChanges,
    normalizeLocalMusicDurationMilliseconds,
    resolveLocalMusicImportFields,
} from "../localMusicSheetPolicy";

interface IItem {
    id: string;
    revision: number;
}

const item = (id: string, revision = 1): IItem => ({ id, revision });

describe("mergeEditedListWithConcurrentChanges", () => {
    it("applies editor ordering and deletion without dropping concurrent additions", () => {
        const a = item("a");
        const b = item("b");
        const concurrent = item("downloaded");

        expect(
            mergeEditedListWithConcurrentChanges({
                baseline: [a, b],
                current: [a, b, concurrent],
                edited: [b],
                getKey: value => value.id,
            }),
        ).toEqual([b, concurrent]);
    });

    it("preserves concurrent updates and does not resurrect concurrent removals", () => {
        const a = item("a");
        const b = item("b");
        const updatedB = item("b", 2);

        expect(
            mergeEditedListWithConcurrentChanges({
                baseline: [a, b],
                current: [updatedB],
                edited: [b, a],
                getKey: value => value.id,
            }),
        ).toEqual([updatedB]);
    });

    it("keeps items explicitly introduced by the editor and deduplicates keys", () => {
        const a = item("a");
        const added = item("added");

        expect(
            mergeEditedListWithConcurrentChanges({
                baseline: [a],
                current: [a],
                edited: [added, a, added],
                getKey: value => value.id,
            }),
        ).toEqual([added, a]);
    });
});

describe("resolveLocalMusicImportFields", () => {
    it("prefers embedded metadata over a Bluetooth-renamed display filename", () => {
        expect(
            resolveLocalMusicImportFields({
                filename: "爱情废柴 - 周杰伦_073402.flac",
                embeddedMetadata: {
                    title: "爱情废柴",
                    artist: "周杰伦",
                },
                fallbackTitle: "爱情废柴 - 周杰伦_073402.flac",
                fallbackArtist: "未知歌手",
            }),
        ).toEqual({
            platform: undefined,
            id: undefined,
            title: "爱情废柴",
            artist: "周杰伦",
        });
    });

    it("falls back to a display filename when embedded metadata is absent", () => {
        expect(
            resolveLocalMusicImportFields({
                filename: "爱情废柴 - 周杰伦_073402.flac",
                embeddedMetadata: null,
                fallbackTitle: "爱情废柴 - 周杰伦_073402.flac",
                fallbackArtist: "未知歌手",
            }),
        ).toMatchObject({
            title: "爱情废柴",
            artist: "周杰伦_073402",
        });
    });

    it("preserves structured MusicFree filename identity and display fields", () => {
        expect(
            resolveLocalMusicImportFields({
                filename: "酷我音乐@123@文件标题@文件歌手.flac",
                embeddedMetadata: {
                    title: "标签标题",
                    artist: "标签歌手",
                },
                fallbackTitle: "fallback.flac",
                fallbackArtist: "未知歌手",
            }),
        ).toEqual({
            platform: "酷我音乐",
            id: "123",
            title: "文件标题",
            artist: "文件歌手",
        });
    });

    it("uses embedded metadata for missing structured display fields", () => {
        expect(
            resolveLocalMusicImportFields({
                filename: "酷我音乐@123@@.flac",
                embeddedMetadata: {
                    title: "标签标题",
                    artist: "标签歌手",
                },
                fallbackTitle: "fallback.flac",
                fallbackArtist: "未知歌手",
            }),
        ).toEqual({
            platform: "酷我音乐",
            id: "123",
            title: "标签标题",
            artist: "标签歌手",
        });
    });
});

describe("normalizeLocalMusicDurationMilliseconds", () => {
    it("keeps finite numeric metadata and rejects invalid duration values", () => {
        expect(normalizeLocalMusicDurationMilliseconds(12_345.9)).toBe(12_345);
        expect(normalizeLocalMusicDurationMilliseconds("12000")).toBe(12_000);
        expect(normalizeLocalMusicDurationMilliseconds("not-a-duration")).toBe(0);
        expect(normalizeLocalMusicDurationMilliseconds(Number.NaN)).toBe(0);
        expect(normalizeLocalMusicDurationMilliseconds(-1)).toBe(0);
    });
});

describe("createLocalMusicFileIdentity", () => {
    const base = {
        displayName: "Track.DSF",
        size: 14_114_908,
        durationMilliseconds: 20_000,
        title: "Track",
        artist: "Artist",
        album: "Album",
    };

    it("matches the same file exposed by different content providers", () => {
        expect(createLocalMusicFileIdentity(base)).toBe(
            createLocalMusicFileIdentity({
                ...base,
                displayName: " track.dsf ",
                title: " track ",
            }),
        );
    });

    it("keeps same-named files distinct when size or duration differs", () => {
        const identity = createLocalMusicFileIdentity(base);
        expect(
            createLocalMusicFileIdentity({ ...base, size: base.size + 1 }),
        ).not.toBe(identity);
        expect(
            createLocalMusicFileIdentity({
                ...base,
                durationMilliseconds: base.durationMilliseconds + 1,
            }),
        ).not.toBe(identity);
    });

    it("requires bounded file facts instead of matching on labels alone", () => {
        expect(
            createLocalMusicFileIdentity({
                displayName: "track.dsf",
                size: null,
                durationMilliseconds: 20_000,
            }),
        ).toBeNull();
        expect(
            createLocalMusicFileIdentity({
                displayName: "track.dsf",
                size: 100,
                durationMilliseconds: Number.NaN,
            }),
        ).toBeNull();
    });
});
