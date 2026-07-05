import { resolveSearchPage } from "../searchPaging";

describe("resolveSearchPage", () => {
    it("uses an explicit query page even when it is greater than one", () => {
        expect(resolveSearchPage(2, true, 1)).toBe(2);
        expect(resolveSearchPage(3, false, 2)).toBe(3);
    });

    it("starts from page one for a new search without an explicit page", () => {
        expect(resolveSearchPage(undefined, true, 4)).toBe(1);
    });

    it("loads the next page from the previous result when continuing", () => {
        expect(resolveSearchPage(undefined, false, 4)).toBe(5);
        expect(resolveSearchPage(undefined, false, undefined)).toBe(1);
    });
});
