import {
    canReadResolvedSourceCache,
    canWriteResolvedSourceCache,
    parseCacheControl,
} from "../cacheControlPolicy";

describe("cacheControlPolicy", () => {
    it("parses supported values and defaults unknown values to no-cache", () => {
        expect(parseCacheControl("cache")).toBe("cache");
        expect(parseCacheControl("no-store")).toBe("no-store");
        expect(parseCacheControl("no-cache")).toBe("no-cache");
        expect(parseCacheControl(undefined)).toBe("no-cache");
        expect(parseCacheControl("other")).toBe("no-cache");
    });

    it("reads resolved sources according to policy and offline state", () => {
        expect(canReadResolvedSourceCache("cache", false)).toBe(true);
        expect(canReadResolvedSourceCache("cache", true)).toBe(true);
        expect(canReadResolvedSourceCache("no-cache", false)).toBe(false);
        expect(canReadResolvedSourceCache("no-cache", true)).toBe(true);
        expect(canReadResolvedSourceCache("no-store", false)).toBe(false);
        expect(canReadResolvedSourceCache("no-store", true)).toBe(false);
    });

    it("writes resolved sources unless policy is no-store", () => {
        expect(canWriteResolvedSourceCache("cache")).toBe(true);
        expect(canWriteResolvedSourceCache("no-cache")).toBe(true);
        expect(canWriteResolvedSourceCache(undefined)).toBe(true);
        expect(canWriteResolvedSourceCache("no-store")).toBe(false);
    });
});
