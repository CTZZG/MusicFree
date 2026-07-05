import {
    buildMusicAlphabetIndex,
    getMusicAlphabetEntryAtOffset,
    getMusicAlphabetSection,
} from "@/utils/musicAlphabetIndex";

describe("musicAlphabetIndex", () => {
    it("maps Latin letters and numbers to stable sections", () => {
        expect(getMusicAlphabetSection("A Million Dreams")).toBe("A");
        expect(getMusicAlphabetSection("  zed")).toBe("Z");
        expect(getMusicAlphabetSection("123")).toBe("0");
        expect(getMusicAlphabetSection("")).toBe("#");
        expect(getMusicAlphabetSection("...")).toBe("#");
    });

    it("maps common Chinese song titles by pinyin initial", () => {
        expect(getMusicAlphabetSection("爱错")).toBe("A");
        expect(getMusicAlphabetSection("触电")).toBe("C");
        expect(getMusicAlphabetSection("在夜静")).toBe("Z");
    });

    it("builds first available indexes for every section", () => {
        const index = buildMusicAlphabetIndex(
            [
                { title: "123" },
                { title: "爱错" },
                { title: "Back In My Life" },
                { title: "爱你" },
            ],
            item => item.title,
        );

        expect(index.find(item => item.section === "0")).toMatchObject({
            available: true,
            index: 0,
        });
        expect(index.find(item => item.section === "A")).toMatchObject({
            available: true,
            index: 1,
        });
        expect(index.find(item => item.section === "B")).toMatchObject({
            available: true,
            index: 2,
        });
        expect(index.find(item => item.section === "C")).toMatchObject({
            available: false,
            index: null,
        });
    });

    it("resolves a touch offset to an alphabet index entry", () => {
        const index = buildMusicAlphabetIndex(
            [{ title: "123" }, { title: "Back In My Life" }, { title: "Zoo" }],
            item => item.title,
        );

        expect(getMusicAlphabetEntryAtOffset(index, 0, 280)?.section).toBe("0");
        expect(getMusicAlphabetEntryAtOffset(index, 15, 280)?.section).toBe("A");
        expect(getMusicAlphabetEntryAtOffset(index, 275, 280)?.section).toBe("#");
        expect(getMusicAlphabetEntryAtOffset(index, -100, 280)?.section).toBe("0");
        expect(getMusicAlphabetEntryAtOffset(index, 1000, 280)?.section).toBe("#");
        expect(getMusicAlphabetEntryAtOffset(index, 10, 0)).toBeNull();
    });
});
