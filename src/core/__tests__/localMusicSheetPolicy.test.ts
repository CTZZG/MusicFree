import { mergeEditedListWithConcurrentChanges } from "../localMusicSheetPolicy";

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
