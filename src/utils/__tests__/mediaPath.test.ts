import { getLowerFileExtension } from "../mediaPath";

describe("mediaPath", () => {
    it("reads lowercase extensions from plain and mixed-case paths", () => {
        expect(getLowerFileExtension("/music/Track.FLAC")).toBe(".flac");
        expect(getLowerFileExtension("C:\\Music\\Track.WMA")).toBe(".wma");
    });

    it("ignores query strings and fragments when reading extensions", () => {
        expect(getLowerFileExtension("/music/Track.WMA?token=1")).toBe(".wma");
        expect(getLowerFileExtension("/music/Track.WMA#cache-bust")).toBe(".wma");
        expect(getLowerFileExtension("/music/Track.WMA?token=1#hash")).toBe(".wma");
    });

    it("does not treat dots in folder names as file extensions", () => {
        expect(getLowerFileExtension("/music.v1/Track")).toBe("");
    });
});
