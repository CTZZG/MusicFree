import {
    SearchRequestGuard,
    getSearchRequestKey,
    getSearchRequestSignature,
} from "../searchRequestGuard";

describe("SearchRequestGuard", () => {
    it("marks the latest request for a key as current", () => {
        const guard = new SearchRequestGuard();
        const first = guard.begin("music:plugin-a");
        const second = guard.begin("music:plugin-a");

        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    it("keeps different plugin/type requests independent", () => {
        const guard = new SearchRequestGuard();
        const musicToken = guard.begin("music:plugin-a");
        const lyricToken = guard.begin("lyric:plugin-a");
        const otherPluginToken = guard.begin("music:plugin-b");

        expect(guard.isCurrent(musicToken)).toBe(true);
        expect(guard.isCurrent(lyricToken)).toBe(true);
        expect(guard.isCurrent(otherPluginToken)).toBe(true);
    });

    it("can reset all active requests", () => {
        const guard = new SearchRequestGuard();
        const token = guard.begin(
            "music:plugin-a",
            "music:plugin-a:1:hello",
        );

        guard.reset();

        expect(guard.isCurrent(token)).toBe(false);
        expect(guard.isInFlight("music:plugin-a:1:hello")).toBe(false);
    });

    it("tracks and clears exact in-flight request signatures", () => {
        const guard = new SearchRequestGuard();
        const token = guard.begin(
            "music:plugin-a",
            "music:plugin-a:2:hello",
        );

        expect(guard.isInFlight("music:plugin-a:2:hello")).toBe(true);
        expect(guard.isInFlight("music:plugin-a:3:hello")).toBe(false);

        guard.finish(token);

        expect(guard.isInFlight("music:plugin-a:2:hello")).toBe(false);
    });

    it("never treats a request from before reset as current again", () => {
        const guard = new SearchRequestGuard();
        const stale = guard.begin("music:plugin-a");

        guard.reset();
        const fresh = guard.begin("music:plugin-a");

        expect(fresh.id).not.toBe(stale.id);
        expect(guard.isCurrent(stale)).toBe(false);
        expect(guard.isCurrent(fresh)).toBe(true);
    });

    it("keeps a newer in-flight signature when a stale request finishes", () => {
        const guard = new SearchRequestGuard();
        const signature = "music:plugin-a:1:hello";
        const stale = guard.begin("music:plugin-a", signature);

        guard.reset();
        guard.begin("music:plugin-a", signature);
        guard.finish(stale);

        expect(guard.isInFlight(signature)).toBe(true);
    });
});

describe("getSearchRequestKey", () => {
    it("separates search type and plugin hash", () => {
        expect(getSearchRequestKey("music", "plugin-a")).toBe(
            "music:plugin-a",
        );
        expect(getSearchRequestKey("lyric", "plugin-a")).toBe(
            "lyric:plugin-a",
        );
    });

    it("separates exact request signatures by page and query", () => {
        expect(
            getSearchRequestSignature("music", "plugin-a", "hello", 2),
        ).toBe("music:plugin-a:2:hello");
        expect(
            getSearchRequestSignature("music", "plugin-a", "world", 2),
        ).toBe("music:plugin-a:2:world");
        expect(
            getSearchRequestSignature("music", "plugin-a", "hello", 3),
        ).toBe("music:plugin-a:3:hello");
    });
});
