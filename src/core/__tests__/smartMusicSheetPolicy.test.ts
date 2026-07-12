import {
    buildSmartSheetLibrarySnapshot,
    createSmartSheetLibrarySnapshotCache,
    getSmartSheetAddedAt,
} from "@/core/smartMusicSheetPolicy";
import type { IMusicPlayStat } from "@/types/core/musicHistory";

const localPluginPlatform = "本地";

function music(
    id: string,
    overrides: Partial<IMusic.IMusicItem> = {},
): IMusic.IMusicItem {
    return {
        id,
        platform: "source-a",
        title: id,
        artist: "artist-a",
        album: "album-a",
        ...overrides,
    } as IMusic.IMusicItem;
}

function stat(
    musicItem: IMusic.IMusicItem,
    count: number,
    lastPlayedAt: number,
): IMusicPlayStat {
    return { musicItem, count, lastPlayedAt };
}

describe("smartMusicSheetPolicy", () => {
    const now = new Date("2026-07-12T00:00:00Z").getTime();

    it("builds the library once, dedupes tracks and ranks recommendations", () => {
        const oftenPlayed = music("often", { artist: "周杰伦" });
        const favorite = music("favorite", { artist: "林俊杰" });
        const local = music("local", {
            platform: localPluginPlatform,
            artist: "陈奕迅",
        });
        const snapshot = buildSmartSheetLibrarySnapshot({
            now,
            history: [oftenPlayed, favorite],
            playStats: {
                "source-a@often": stat(oftenPlayed, 12, now - 86_400_000),
                "source-a@favorite": stat(favorite, 1, now - 20 * 86_400_000),
            },
            localMusicList: [local, oftenPlayed],
            downloadedMusicList: [],
            localPluginPlatform,
            sheets: [{
                id: "favorite",
                platform: localPluginPlatform,
                title: "favorite",
                musicList: [favorite, oftenPlayed],
            } as IMusic.IMusicSheetItem],
        });

        expect(snapshot.known.map(item => item.id)).toEqual([
            "often",
            "favorite",
            "local",
        ]);
        expect(snapshot.recommended[0].id).toBe("often");
        expect(snapshot.favorite.map(item => item.id)).toEqual([
            "favorite",
            "often",
        ]);
    });

    it("sorts facets by listening signals instead of alphabetically", () => {
        const active = music("active", { artist: "Z Artist", album: "Z Album" });
        const inactive = music("inactive", { artist: "A Artist", album: "A Album" });
        const snapshot = buildSmartSheetLibrarySnapshot({
            now,
            history: [active, inactive],
            playStats: {
                "source-a@active": stat(active, 20, now),
                "source-a@inactive": stat(inactive, 1, now - 100 * 86_400_000),
            },
            localMusicList: [],
            downloadedMusicList: [],
            localPluginPlatform,
            sheets: [],
        });

        expect(snapshot.artistFacets[0].value).toBe("Z Artist");
        expect(snapshot.albumFacets[0].value).toBe("Z Album");
    });

    it("detects downloads and keeps recent additions in newest-first order", () => {
        const older = music("older", {
            $timestamp: now - 2_000,
        });
        const newer = music("newer", {
            $timestamp: now - 1_000,
        });
        const downloaded = music("downloaded", {
            $: { localPath: "/music/downloaded.flac" },
        } as Partial<IMusic.IMusicItem>);
        const snapshot = buildSmartSheetLibrarySnapshot({
            now,
            history: [],
            playStats: {},
            localMusicList: [downloaded],
            downloadedMusicList: [downloaded],
            localPluginPlatform,
            sheets: [{
                id: "sheet",
                platform: localPluginPlatform,
                title: "sheet",
                musicList: [older, newer],
            } as IMusic.IMusicSheetItem],
        });

        expect(snapshot.recentAdded.map(item => item.id)).toEqual([
            "newer",
            "older",
        ]);
        expect(snapshot.downloaded.map(item => item.id)).toEqual(["downloaded"]);
    });

    it("reuses cached snapshots and invalidates them when scoring inputs change", () => {
        const track = music("cached");
        const options = {
            now,
            history: [track],
            playStats: {},
            localMusicList: [],
            downloadedMusicList: [],
            localPluginPlatform,
            sheets: [],
        };
        const cache = createSmartSheetLibrarySnapshotCache();

        const first = cache.get(options);
        expect(cache.get(options)).toBe(first);

        const rescored = cache.get({
            ...options,
            playStats: {
                "source-a@cached": stat(track, 3, now),
            },
        });
        expect(rescored).not.toBe(first);
        expect(rescored.mostPlayed.map(item => item.id)).toEqual(["cached"]);
    });

    it("normalizes recent-added timestamps from common metadata fields", () => {
        expect(getSmartSheetAddedAt(music("seconds", { addedAt: 1234 }))).toBe(
            1_234_000,
        );
        expect(getSmartSheetAddedAt(music("iso", {
            createdAt: "2026-07-12T00:00:00Z",
        }))).toBe(now);
    });
});
