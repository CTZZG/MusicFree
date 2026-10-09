import {
    mergeMediaExtra,
    mergeMusicList,
    mergeSheetIndex,
    mergeStarredSheetIndex,
    sheetStoreMerge,
} from "../legacyMerge";

const json = (value: unknown) => JSON.stringify(value);

describe("merging old MMKV data into what the new store already has", () => {
    it("keeps the user's sheet order and the newer fields of the same sheet", () => {
        const merged = mergeSheetIndex(
            json([{ id: "favorite", title: "我喜欢", coverImg: "old.jpg" }, { id: "a", title: "A" }]),
            json([{ id: "favorite", title: "我喜欢", coverImg: "new.jpg" }, { id: "b", title: "B" }]),
        );
        expect(JSON.parse(merged!)).toEqual([
            { id: "favorite", title: "我喜欢", coverImg: "new.jpg" },
            { id: "a", title: "A" },
            { id: "b", title: "B" },
        ]);
    });

    it("tells starred sheets from different plugins apart", () => {
        const merged = mergeStarredSheetIndex(
            json([{ id: "1", platform: "kuwo" }]),
            json([{ id: "1", platform: "netease" }]),
        );
        expect(JSON.parse(merged!)).toHaveLength(2);
    });

    it("puts songs added after the upgrade first and drops duplicates", () => {
        const merged = mergeMusicList(
            json([{ id: "1", platform: "kuwo", title: "old" }, { id: "2", platform: "kuwo" }]),
            json([{ id: "1", platform: "kuwo", title: "new" }, { id: "3", platform: "kuwo" }]),
        );
        expect(JSON.parse(merged!).map((item: { id: string; title?: string }) => `${item.id}:${item.title ?? ""}`)).toEqual([
            "1:new",
            "3:",
            "2:",
        ]);
    });

    it("merges media extras field by field, newer values first", () => {
        expect(
            JSON.parse(mergeMediaExtra(json({ downloaded: true, lyricOffset: 200 }), json({ lyricOffset: 500 }))!),
        ).toEqual({ downloaded: true, lyricOffset: 500 });
    });

    it("leaves the new value alone when either side cannot be read", () => {
        expect(mergeSheetIndex("not json", json([]))).toBeUndefined();
        expect(mergeMusicList(json([]), "{")).toBeUndefined();
        expect(mergeMediaExtra(json([1]), json({}))).toBeUndefined();
    });

    it("keeps sheet settings changed after the upgrade", () => {
        const merge = sheetStoreMerge("favorite");
        expect(merge("meta.sort", "title", "time")).toBeUndefined();
        expect(merge("data", json([{ id: "1", platform: "p" }]), json([]))).toBe(json([{ id: "1", platform: "p" }]));
    });
});
