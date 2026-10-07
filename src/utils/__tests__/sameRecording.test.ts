import { matchRecording } from "../sameRecording";

function song(overrides: Partial<IMusic.IMusicItem> = {}): IMusic.IMusicItem {
    return {
        id: "1",
        platform: "A",
        title: "晴天",
        artist: "周杰伦",
        album: "叶惠美",
        duration: 269,
        ...overrides,
    } as IMusic.IMusicItem;
}

describe("matchRecording", () => {
    it("matches the same recording across formatting differences between platforms", () => {
        expect(matchRecording(
            song({ title: "说好的幸福呢（Live）", artist: "周杰伦/费玉清" }),
            song({ title: "说好的幸福呢 (live)", artist: "费玉清、周杰伦", duration: 270 }),
        )).not.toBeNull();
        expect(matchRecording(
            song({ title: "Ｌｏｖｅ　Ｓｔｏｒｙ", artist: "Taylor Swift" }),
            song({ title: "love story", artist: "taylor swift" }),
        )).not.toBeNull();
        expect(matchRecording(
            song({ title: "晴天【Live】" }),
            song({ title: "晴天 [Live]" }),
        )).not.toBeNull();
    });

    it("never treats a different version, singer or length as the same song", () => {
        // Live 版和录音室版
        expect(matchRecording(song(), song({ title: "晴天 (Live)" }))).toBeNull();
        // 翻唱
        expect(matchRecording(song(), song({ artist: "某翻唱歌手" }))).toBeNull();
        // 多一位合唱歌手
        expect(matchRecording(song(), song({ artist: "周杰伦 feat. 杨瑞代" }))).toBeNull();
        // 时长差 3 秒（剪辑版、带前奏的版本）
        expect(matchRecording(song(), song({ duration: 272 }))).toBeNull();
        // 一边给的是毫秒
        expect(matchRecording(song(), song({ duration: 269000 }))).toBeNull();
    });

    it("refuses to guess when either side lacks the title, singer or length", () => {
        expect(matchRecording(song({ duration: 0 }), song())).toBeNull();
        expect(matchRecording(song(), song({ duration: undefined as any }))).toBeNull();
        expect(matchRecording(song({ artist: "" }), song({ artist: "" }))).toBeNull();
        expect(matchRecording(song({ title: " " }), song({ title: " " }))).toBeNull();
        expect(matchRecording(null, song())).toBeNull();
    });

    it("accepts a duration given as a numeric string", () => {
        expect(matchRecording(song(), song({ duration: "269" as any }))).toBe(0);
    });

    it("ranks the same album and closer lengths first", () => {
        const sameAlbum = matchRecording(song(), song({ duration: 271 }));
        const otherAlbum = matchRecording(song(), song({ album: "周杰伦精选" }));
        const noAlbum = matchRecording(song(), song({ album: "" }));
        expect(sameAlbum).toBe(2);
        expect(otherAlbum).toBeGreaterThan(sameAlbum!);
        expect(noAlbum).toBe(otherAlbum);
        expect(matchRecording(song(), song({ duration: 270 }))).toBeLessThan(sameAlbum!);
    });
});
