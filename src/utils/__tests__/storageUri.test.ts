import {
    classifyStorageUri,
    isContentUri,
    requireFilePath,
} from "../storageUri";

describe("storageUri", () => {
    const appRoots = ["/data/user/0/fun.upup.musicfree/files"];

    it.each([
        [
            "/storage/emulated/0/Music/song.mp3",
            "file-path",
            "/storage/emulated/0/Music/song.mp3",
        ],
        [
            "file:///storage/emulated/0/Music/My%20Song.mp3",
            "file-uri",
            "/storage/emulated/0/Music/My Song.mp3",
        ],
        [
            "content://media/external/audio/media/42",
            "content-uri",
            undefined,
        ],
        [
            "/data/user/0/fun.upup.musicfree/files/download/song.mp3",
            "app-scoped-path",
            "/data/user/0/fun.upup.musicfree/files/download/song.mp3",
        ],
    ])("classifies %s as %s", (value, kind, filePath) => {
        const result = classifyStorageUri(value, appRoots);
        expect(result.kind).toBe(kind);
        expect(result.filePath).toBe(filePath);
    });

    it("uses path boundaries when recognizing app-scoped paths", () => {
        expect(
            classifyStorageUri(
                "/data/user/0/fun.upup.musicfree/files-escape/song.mp3",
                appRoots,
            ).isAppScoped,
        ).toBe(false);
    });

    it("does not coerce content or remote URIs into file paths", () => {
        expect(isContentUri("content://provider/item")).toBe(true);
        expect(() => requireFilePath("content://provider/item")).toThrow(
            "content URI",
        );
        expect(classifyStorageUri("https://example.com/song.mp3").kind).toBe(
            "unsupported",
        );
    });

    it("rejects malformed and remote-host file URIs", () => {
        expect(classifyStorageUri("file://server/share/song.mp3").kind).toBe(
            "unsupported",
        );
        expect(classifyStorageUri("file:///%E0%A4%A").kind).toBe(
            "unsupported",
        );
    });
});
