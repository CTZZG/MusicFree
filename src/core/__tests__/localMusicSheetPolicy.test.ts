import {
    mergeEditedListWithConcurrentChanges,
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
