import {
    createLocalMusicArtworkResolver,
    getDirectArtworkUri,
    mergeResolvedArtwork,
    stripEphemeralLocalArtwork,
} from "../localMusicArtwork";

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("createLocalMusicArtworkResolver", () => {
    it("deduplicates in-flight requests and caches resolved artwork", async () => {
        let resolveLoader!: (value: string) => void;
        const loader = jest.fn(
            () =>
                new Promise<string>(resolve => {
                    resolveLoader = resolve;
                }),
        );
        const resolver = createLocalMusicArtworkResolver(loader, 2);

        const first = resolver.resolve("/music/song.flac");
        const second = resolver.resolve("/music/song.flac");
        await flushPromises();

        expect(loader).toHaveBeenCalledTimes(1);
        resolveLoader(" file:///cache/cover.jpg ");
        await expect(first).resolves.toBe("file:///cache/cover.jpg");
        await expect(second).resolves.toBe("file:///cache/cover.jpg");
        await expect(resolver.resolve("/music/song.flac")).resolves.toBe(
            "file:///cache/cover.jpg",
        );
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("limits concurrent native artwork extraction", async () => {
        let activeCount = 0;
        let maxActiveCount = 0;
        const loader = jest.fn(async (path: string) => {
            activeCount += 1;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            await new Promise(resolve => setTimeout(resolve, 5));
            activeCount -= 1;
            return `file:///cache/${path}.jpg`;
        });
        const resolver = createLocalMusicArtworkResolver(loader, 2);

        await expect(
            Promise.all([
                resolver.resolve("a"),
                resolver.resolve("b"),
                resolver.resolve("c"),
            ]),
        ).resolves.toHaveLength(3);
        expect(loader).toHaveBeenCalledTimes(3);
        expect(maxActiveCount).toBe(2);
    });

    it("uses and caches the empty fallback when extraction fails", async () => {
        let now = 100;
        const loader = jest.fn().mockRejectedValue(new Error("unsupported"));
        const resolver = createLocalMusicArtworkResolver(loader, 3, {
            failureTtlMs: 10,
            now: () => now,
        });

        await expect(resolver.resolve("/music/no-cover.dsf")).resolves.toBe("");
        await expect(resolver.resolve("/music/no-cover.dsf")).resolves.toBe("");
        expect(loader).toHaveBeenCalledTimes(1);

        now += 11;
        await expect(resolver.resolve("/music/no-cover.dsf")).resolves.toBe("");
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("evicts least recently used artwork and supports path invalidation", async () => {
        const loader = jest.fn(async path => `file:///cache/${path}.jpg`);
        const resolver = createLocalMusicArtworkResolver(loader, 2, {
            maxEntries: 2,
        });

        await resolver.resolve("a");
        await resolver.resolve("b");
        await resolver.resolve("a");
        await resolver.resolve("c");
        await resolver.resolve("b");
        expect(loader).toHaveBeenCalledTimes(4);

        resolver.invalidate("a");
        await resolver.resolve("a");
        expect(loader).toHaveBeenCalledTimes(5);
    });

    it("settles active and queued requests when the resolver is cleared", async () => {
        let resolveLoader!: (value: string) => void;
        const loader = jest.fn(
            () =>
                new Promise<string>(resolve => {
                    resolveLoader = resolve;
                }),
        );
        const resolver = createLocalMusicArtworkResolver(loader, 1);
        const active = resolver.resolve("active");
        const queued = resolver.resolve("queued");
        await flushPromises();
        expect(loader).toHaveBeenCalledTimes(1);

        resolver.clear();
        await expect(active).resolves.toBe("");
        await expect(queued).resolves.toBe("");
        expect(loader).toHaveBeenCalledTimes(1);

        resolveLoader("file:///stale.jpg");
        await flushPromises();
        const next = resolver.resolve("queued");
        await flushPromises();
        expect(loader).toHaveBeenCalledTimes(2);
        resolver.clear();
        await expect(next).resolves.toBe("");
    });

    it("does not let an invalidated active result populate the cache", async () => {
        const loaders: Array<(value: string) => void> = [];
        const loader = jest.fn(
            () =>
                new Promise<string>(resolve => {
                    loaders.push(resolve);
                }),
        );
        const resolver = createLocalMusicArtworkResolver(loader, 1);
        const staleRequest = resolver.resolve("song");
        await flushPromises();

        resolver.invalidate("song");
        await expect(staleRequest).resolves.toBe("");
        const freshRequest = resolver.resolve("song");
        loaders[0]("file:///stale.jpg");
        await flushPromises();
        await flushPromises();
        expect(loader).toHaveBeenCalledTimes(2);
        loaders[1]("file:///fresh.jpg");

        await expect(freshRequest).resolves.toBe("file:///fresh.jpg");
        await expect(resolver.resolve("song")).resolves.toBe(
            "file:///fresh.jpg",
        );
    });
});

describe("local artwork metadata helpers", () => {
    it("normalizes string and React Native uri artwork", () => {
        expect(getDirectArtworkUri(" file:///cover.jpg ")).toBe(
            "file:///cover.jpg",
        );
        expect(getDirectArtworkUri({ uri: " content://cover/1 " })).toBe(
            "content://cover/1",
        );
        expect(getDirectArtworkUri(undefined)).toBe("");
    });

    it("fills missing artwork without overwriting an existing cover", () => {
        const musicItem = { id: "1", artwork: "" };
        expect(
            mergeResolvedArtwork(musicItem, " file:///embedded.jpg "),
        ).toEqual({ id: "1", artwork: "file:///embedded.jpg" });

        const existing = { id: "2", artwork: "https://cover/existing.jpg" };
        expect(mergeResolvedArtwork(existing, "file:///embedded.jpg")).toBe(
            existing,
        );
    });

    it("removes cache-backed artwork before persistence", () => {
        expect(
            stripEphemeralLocalArtwork({
                id: "local",
                artwork:
                    "file:///data/user/0/app/cache/image_manager_disk_cache/a.jpg",
            }),
        ).toEqual({ id: "local", artwork: "" });
        const remote = { id: "remote", artwork: "https://cover/a.jpg" };
        expect(stripEphemeralLocalArtwork(remote)).toBe(remote);
    });
});
