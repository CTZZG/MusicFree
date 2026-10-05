jest.mock("react-native-reanimated", () => ({ Easing: { exp: jest.fn(), out: jest.fn((value: unknown) => value) } }));
import { aggregateMusicResults } from "../aggregateMusicResults";
import { RequestStateCode } from "@/constants/commonConst";
import type { ISearchSourceResult } from "../searchSession";
const sources = [{ hash: "a", name: "A" }, { hash: "b", name: "B" }];
const song: IMusic.IMusicItem = { id: "1", platform: "A", title: "Song", artist: "Artist", album: "Album", duration: 180, artwork: "" };
const alternate = { ...song, id: "2", platform: "B" };
function results(a: IMusic.IMusicItem[], b: IMusic.IMusicItem[]) {
    const result = (data: IMusic.IMusicItem[]): ISearchSourceResult<"music"> => ({ data, state: RequestStateCode.FINISHED, query: "song", page: 1 });
    return { a: result(a), b: result(b) };
}
it("groups full matching metadata and retains the exact original source objects", () => {
    const groups = aggregateMusicResults(sources, results([song], [alternate]));
    expect(groups).toHaveLength(1);
    expect(groups[0].choices.map(choice => choice.musicItem)).toEqual([song, alternate]);
    expect(groups[0].choices[1].musicItem).toBe(alternate);
});
it.each([
    { title: "Song (Live)" }, { artist: "Cover Artist" }, { album: "Live Album" }, { duration: 220 }, { album: "" }, { duration: 0 },
])("preserves different or incomplete version metadata: %p", change => {
    expect(aggregateMusicResults(sources, results([song], [{ ...alternate, ...change }]))).toHaveLength(2);
});
it("does not merge an ambiguous recording with multiple IDs in one provider", () => {
    const groups = aggregateMusicResults(sources, results([song, { ...song, id: "another" }], [alternate]));
    expect(groups).toHaveLength(3);
});
it("interleaves source ranking and deduplicates repeated provider IDs", () => {
    const a2 = { ...song, id: "a2", title: "A second" };
    const b2 = { ...alternate, id: "b2", title: "B second" };
    const groups = aggregateMusicResults(sources, results([song, a2, song], [{ ...alternate, title: "B first" }, b2]));
    expect(groups.map(group => group.choices[0].musicItem.title)).toEqual(["Song", "B first", "A second", "B second"]);
});
it("excludes disabled sources by using the currently enabled roster", () => {
    expect(aggregateMusicResults([sources[0]], results([song], [alternate]))[0].choices).toHaveLength(1);
});
