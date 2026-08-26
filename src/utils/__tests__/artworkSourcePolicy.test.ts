import {
    getArtworkUri,
    getNativeArtworkUri,
    isUsableArtworkUri,
} from "../artworkSourcePolicy";

describe("artworkSourcePolicy", () => {
    it("normalizes string and React Native uri values", () => {
        expect(getArtworkUri(" file:///cover.jpg ")).toBe(
            "file:///cover.jpg",
        );
        expect(getArtworkUri({ uri: " content://cover/1 " })).toBe(
            "content://cover/1",
        );
        expect(getArtworkUri({ uri: 42 })).toBe("");
    });

    it.each([
        "https://localhost/cover.jpg",
        "https://127.0.0.1/cover.jpg",
        "https://10.0.0.1/cover.jpg",
        "https://user:secret@example.com/cover.jpg",
        "http://localhost/cover.jpg",
        "http://192.168.1.10/cover.jpg",
        "http://user:secret@example.com/cover.jpg",
        ["java", "script:alert(1)"].join(""),
    ])("rejects unsafe artwork URLs: %s", uri => {
        expect(isUsableArtworkUri(uri)).toBe(false);
        expect(getNativeArtworkUri(uri)).toBeUndefined();
    });

    // 明文 http 封面必须放行。大量音源（酷我等）只提供 http 封面，之前一律
    // 拒绝会让锁屏/通知/灵动岛退化成默认图标。封面是展示用的图片，不含凭据，
    // 且地址安全仍由上面那组用例覆盖的私有网段/凭据检查负责。
    it.each([
        "http://example.com/cover.jpg",
        "http://img1.kuwo.cn/star/albumcover/500/cover.jpg",
    ])("allows public cleartext artwork URLs: %s", uri => {
        expect(isUsableArtworkUri(uri)).toBe(true);
        expect(getNativeArtworkUri(uri)).toBe(uri);
    });

    it("separates UI-only artwork schemes from native consumers", () => {
        expect(isUsableArtworkUri("data:image/png;base64,AA==")).toBe(true);
        expect(getNativeArtworkUri("data:image/png;base64,AA=="))
            .toBeUndefined();
        expect(getNativeArtworkUri("content://cover/1")).toBe(
            "content://cover/1",
        );
        expect(getNativeArtworkUri("/storage/emulated/0/cover.jpg")).toBe(
            "/storage/emulated/0/cover.jpg",
        );
        expect(getNativeArtworkUri("https://example.com/cover.jpg")).toBe(
            "https://example.com/cover.jpg",
        );
    });
});
