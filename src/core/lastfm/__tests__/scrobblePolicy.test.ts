import {
    accumulateListenedSeconds,
    appendPendingScrobble,
    buildNowPlayingParams,
    buildScrobbleBatchParams,
    isScrobbleEligible,
    MAX_PENDING_SCROBBLES,
    MAX_SCROBBLE_BATCH,
    MIN_SCROBBLE_DURATION_SECONDS,
    toScrobbleEntry,
    type ScrobbleEntry,
} from "../scrobblePolicy";

function makeEntry(overrides: Partial<ScrobbleEntry> = {}): ScrobbleEntry {
    return {
        artist: "Artist",
        track: "Track",
        timestamp: 1_700_000_000,
        ...overrides,
    };
}

describe("isScrobbleEligible", () => {
    it("30 秒以内的曲目永远不算，符合官方规则", () => {
        expect(
            isScrobbleEligible({
                duration: MIN_SCROBBLE_DURATION_SECONDS,
                listenedSeconds: 999,
            }),
        ).toBe(false);
        expect(
            isScrobbleEligible({ duration: 10, listenedSeconds: 10 }),
        ).toBe(false);
    });

    it("听满一半就算", () => {
        expect(
            isScrobbleEligible({ duration: 200, listenedSeconds: 100 }),
        ).toBe(true);
        expect(
            isScrobbleEligible({ duration: 200, listenedSeconds: 99 }),
        ).toBe(false);
    });

    it("超长曲目听满 4 分钟就算，不必等到一半", () => {
        expect(
            isScrobbleEligible({ duration: 3600, listenedSeconds: 240 }),
        ).toBe(true);
        expect(
            isScrobbleEligible({ duration: 3600, listenedSeconds: 239 }),
        ).toBe(false);
    });

    it("坏数据一律不算", () => {
        expect(
            isScrobbleEligible({ duration: NaN, listenedSeconds: 100 }),
        ).toBe(false);
        expect(
            isScrobbleEligible({ duration: 200, listenedSeconds: 0 }),
        ).toBe(false);
    });
});

describe("toScrobbleEntry", () => {
    it("缺歌手或标题的条目直接判废", () => {
        expect(toScrobbleEntry({ title: "只有标题" }, 1)).toBeNull();
        expect(toScrobbleEntry({ artist: "只有歌手" }, 1)).toBeNull();
        expect(toScrobbleEntry({ title: "  ", artist: " " }, 1)).toBeNull();
        expect(toScrobbleEntry(null, 1)).toBeNull();
    });

    it("正常条目去掉首尾空白并取整时间戳", () => {
        const entry = toScrobbleEntry(
            {
                title: " 歌名 ",
                artist: " 歌手 ",
                album: " 专辑 ",
                duration: 200.7,
            },
            1_700_000_000.9,
        );
        expect(entry).toEqual({
            artist: "歌手",
            track: "歌名",
            album: "专辑",
            duration: 201,
            timestamp: 1_700_000_000,
        });
    });

    it("空专辑和非法时长被省略而不是塞个空值上去", () => {
        const entry = toScrobbleEntry(
            { title: "歌名", artist: "歌手", album: "", duration: 0 },
            1,
        );
        expect(entry?.album).toBeUndefined();
        expect(entry?.duration).toBeUndefined();
    });
});

describe("appendPendingScrobble", () => {
    it("正常追加到队尾", () => {
        const result = appendPendingScrobble([makeEntry()], makeEntry({
            track: "第二首",
        }));
        expect(result).toHaveLength(2);
        expect(result[1].track).toBe("第二首");
    });

    it("超过上限时丢最旧的，保住最新的记录", () => {
        const full = Array.from({ length: MAX_PENDING_SCROBBLES }, (_, i) =>
            makeEntry({ track: `旧${i}` }),
        );
        const result = appendPendingScrobble(full, makeEntry({ track: "新" }));
        expect(result).toHaveLength(MAX_PENDING_SCROBBLES);
        expect(result[result.length - 1].track).toBe("新");
        expect(result[0].track).toBe("旧1");
    });
});

describe("buildScrobbleBatchParams", () => {
    it("按 Last.fm 的下标格式展开", () => {
        const params = buildScrobbleBatchParams([
            makeEntry({ track: "A", album: "AA", duration: 100 }),
            makeEntry({ track: "B", timestamp: 1_700_000_100 }),
        ]);
        expect(params["artist[0]"]).toBe("Artist");
        expect(params["track[0]"]).toBe("A");
        expect(params["album[0]"]).toBe("AA");
        expect(params["duration[0]"]).toBe("100");
        expect(params["track[1]"]).toBe("B");
        expect(params["timestamp[1]"]).toBe("1700000100");
        // 没有专辑/时长的条目不占位
        expect(params["album[1]"]).toBeUndefined();
        expect(params["duration[1]"]).toBeUndefined();
    });

    it("单批最多 50 条", () => {
        const entries = Array.from({ length: 80 }, (_, i) =>
            makeEntry({ track: `T${i}` }),
        );
        const params = buildScrobbleBatchParams(entries);
        expect(params[`track[${MAX_SCROBBLE_BATCH - 1}]`]).toBeDefined();
        expect(params[`track[${MAX_SCROBBLE_BATCH}]`]).toBeUndefined();
    });
});

describe("buildNowPlayingParams", () => {
    it("只带必要字段", () => {
        expect(buildNowPlayingParams(makeEntry())).toEqual({
            artist: "Artist",
            track: "Track",
        });
        expect(
            buildNowPlayingParams(makeEntry({ album: "AA", duration: 100 })),
        ).toEqual({
            artist: "Artist",
            track: "Track",
            album: "AA",
            duration: "100",
        });
    });
});

describe("accumulateListenedSeconds", () => {
    it("正常累加", () => {
        expect(accumulateListenedSeconds(10, 1)).toBe(11);
    });

    it("超大间隔被掐掉，防止挂起后回来一次凑够阈值", () => {
        expect(accumulateListenedSeconds(0, 3600)).toBe(5);
    });

    it("非法或倒退的增量被忽略", () => {
        expect(accumulateListenedSeconds(10, -5)).toBe(10);
        expect(accumulateListenedSeconds(10, NaN)).toBe(10);
    });
});
