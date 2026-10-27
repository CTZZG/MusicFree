import { getShareCardLayout, toggleShareLine, wrapCardText } from "../cardLayout";

describe("song and lyric card layout", () => {
    it("keeps selection in lyric order, caps four lines and supports deselecting", () => {
        let selected: number[] = [];
        for (const index of [5, 3, 8, 1]) selected = toggleShareLine(selected, index);
        expect(selected).toEqual([1, 3, 5, 8]);
        expect(toggleShareLine(selected, 10)).toBe(selected);
        expect(toggleShareLine(selected, 3)).toEqual([1, 5, 8]);
    });

    it("bounds long CJK/Latin lines and never cuts a surrogate pair", () => {
        for (const text of [
            "汉字かな한글".repeat(40),
            "UnbrokenLongWord".repeat(40),
            "🎵".repeat(80),
        ]) {
            const lines = wrapCardText(text, 17, 3);
            expect(lines).toHaveLength(3);
            expect(lines[2]).toMatch(/…$/);
            expect(lines.join("")).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        }
    });

    it("wraps wide Latin characters before they can cross the card edge", () => {
        const word = "W".repeat(26);
        const card = getShareCardLayout(word, "", [{ index: 0, text: word }], false);
        expect(card.title).toHaveLength(2);
        expect(card.text).toHaveLength(2);
        expect(card.title.join("")).toBe(word);
        expect(card.text.map(row => row.text).join("")).toBe(word);
        expect(card.text[0].text.length).toBeLessThanOrEqual(17);
    });

    it("fits the maximum translated selection and separates title from the image", () => {
        const lines = Array.from({ length: 4 }, (_, index) => ({
            index,
            text: "字".repeat(100),
            translation: "译".repeat(100),
        }));
        const card = getShareCardLayout(
            "title".repeat(40),
            "artist".repeat(40),
            lines,
            true,
        );
        expect(card.title).toHaveLength(2);
        expect(card.artist).toHaveLength(1);
        expect(card.height).toBeLessThan(2000);
        expect(card.text.every(row => row.y >= 294 && row.y < card.height - 90)).toBe(
            true,
        );
        expect(card.text.some(row => row.secondary)).toBe(true);
        expect(
            getShareCardLayout("Title", "Artist", lines, false).text.every(
                row => !row.secondary,
            ),
        ).toBe(true);
    });
});
