jest.mock("react-native-fs", () => ({
    exists: jest.fn(),
}));

import { createPathValueResolver } from "../localFileStatusCache";

describe("createPathValueResolver", () => {
    it("deduplicates requests and limits concurrent work", async () => {
        let active = 0;
        let maxActive = 0;
        const loader = jest.fn(async (path: string) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return path !== "missing";
        });
        const resolver = createPathValueResolver(loader, {
            maxConcurrent: 2,
            getTtlMs: () => 1000,
        });

        const results = await Promise.all([
            resolver.resolve("a"),
            resolver.resolve("a"),
            resolver.resolve("b"),
            resolver.resolve("c"),
        ]);

        expect(results).toEqual([true, true, true, true]);
        expect(loader).toHaveBeenCalledTimes(3);
        expect(maxActive).toBe(2);
    });

    it("expires missing results earlier and supports path invalidation", async () => {
        let now = 100;
        const loader = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
        const resolver = createPathValueResolver(loader, {
            now: () => now,
            getTtlMs: value => value ? 1000 : 10,
        });

        await expect(resolver.resolve("song.flac")).resolves.toBe(false);
        now += 9;
        await expect(resolver.resolve("song.flac")).resolves.toBe(false);
        expect(loader).toHaveBeenCalledTimes(1);

        now += 2;
        await expect(resolver.resolve("song.flac")).resolves.toBe(true);
        resolver.invalidate("song.flac");
        await expect(resolver.resolve("song.flac")).resolves.toBe(true);
        expect(loader).toHaveBeenCalledTimes(3);
    });

    it("does not cache a stale result after invalidation", async () => {
        let resolveFirst!: (value: boolean) => void;
        const loader = jest.fn()
            .mockImplementationOnce(() => new Promise<boolean>(resolve => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce(true);
        const resolver = createPathValueResolver(loader, {
            getTtlMs: () => 1000,
        });

        const staleRequest = resolver.resolve("song.flac");
        await Promise.resolve();
        resolver.invalidate("song.flac");
        const freshRequest = resolver.resolve("song.flac");
        resolveFirst(false);

        await expect(staleRequest).resolves.toBe(false);
        await expect(freshRequest).resolves.toBe(true);
        await expect(resolver.resolve("song.flac")).resolves.toBe(true);
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("evicts least recently used entries at the configured limit", async () => {
        const loader = jest.fn(async (path: string) => path);
        const resolver = createPathValueResolver(loader, {
            maxEntries: 2,
            getTtlMs: () => 1000,
        });

        await resolver.resolve("a");
        await resolver.resolve("b");
        expect(resolver.peek("a")).toBe("a");
        await resolver.resolve("c");

        expect(resolver.peek("a")).toBe("a");
        expect(resolver.peek("b")).toBeUndefined();
        expect(resolver.peek("c")).toBe("c");
    });
});
