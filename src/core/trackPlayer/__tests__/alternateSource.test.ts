const mockStore = new Map<string, unknown>();
let mockTimeout: (() => void) | null = null;

jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: {
        get: (key: string) => mockStore.get(key) ?? null,
        set: (key: string, value: unknown) => {
            if (value === undefined) {
                mockStore.delete(key);
            } else {
                mockStore.set(key, JSON.parse(JSON.stringify(value)));
            }
        },
    },
}));

jest.mock("@/utils/delay", () => ({
    __esModule: true,
    default: () => new Promise<void>(resolve => {
        mockTimeout = resolve;
    }),
}));

import {
    alternateSearchKeyword,
    findAlternateCandidates,
    forgetAlternate,
    getRememberedAlternate,
    rememberAlternate,
    type AlternateSearchSource,
} from "../alternateSource";

function song(overrides: Partial<IMusic.IMusicItem> = {}): IMusic.IMusicItem {
    return {
        id: "orig",
        platform: "源A",
        title: "晴天",
        artist: "周杰伦/费玉清",
        album: "叶惠美",
        duration: 269,
        ...overrides,
    } as IMusic.IMusicItem;
}

function source(name: string, results: IMusic.IMusicItem[] | Error | "never"): AlternateSearchSource & { search: jest.Mock } {
    return {
        name,
        search: jest.fn(async () => {
            if (results === "never") {
                return new Promise<IMusic.IMusicItem[]>(() => undefined);
            }
            if (results instanceof Error) {
                throw results;
            }
            return results;
        }),
    };
}

describe("findAlternateCandidates", () => {
    beforeEach(() => {
        mockTimeout = null;
    });

    it("searches the other sources by title and first singer, keeping only the same recording", async () => {
        const original = song();
        const own = source("源A", [song({ id: "dup" })]);
        const b = source("源B", [
            song({ id: "b-live", platform: "源B", title: "晴天 (Live)" }),
            song({ id: "b-other-album", platform: "源B", album: "精选" }),
        ]);
        const c = source("源C", [
            song({ id: "c-cover", platform: "源C", artist: "别人" }),
            song({ id: "c-same", platform: "源C", duration: 270 }),
        ]);

        const candidates = await findAlternateCandidates(original, [own, b, c], { timeoutMs: 8000 });

        expect(own.search).not.toHaveBeenCalled();
        expect(b.search).toHaveBeenCalledWith("晴天 周杰伦");
        // 专辑一致的排在专辑不同的前面，不管来源顺序
        expect(candidates.map(item => item.id)).toEqual(["c-same", "b-other-album"]);
    });

    it("only looks at the first five results of each source", async () => {
        const fillers = Array.from({ length: 5 }, (_, index) =>
            song({ id: `x${index}`, platform: "源B", title: `别的歌 ${index}` }));
        const b = source("源B", [...fillers, song({ id: "sixth", platform: "源B" })]);

        await expect(findAlternateCandidates(song(), [b], { timeoutMs: 8000 })).resolves.toEqual([]);
    });

    it("stops waiting for slow sources at the deadline and ignores failing ones", async () => {
        const slow = source("源B", "never");
        const broken = source("源C", new Error("boom"));
        const fast = source("源D", [song({ id: "d", platform: "源D" })]);

        const pending = findAlternateCandidates(song(), [slow, broken, fast], { timeoutMs: 8000 });
        await Promise.resolve();
        mockTimeout?.();
        await expect(pending).resolves.toEqual([expect.objectContaining({ id: "d", platform: "源D" })]);
    });

    it("returns nothing once the play request has been replaced", async () => {
        const b = source("源B", [song({ id: "b", platform: "源B" })]);
        await expect(findAlternateCandidates(song(), [b], {
            timeoutMs: 8000,
            isCancelled: () => true,
        })).resolves.toEqual([]);
    });

    it("does not search without a title", async () => {
        const b = source("源B", [song({ platform: "源B" })]);
        expect(alternateSearchKeyword(song({ title: " " }))).toBe("");
        await expect(findAlternateCandidates(song({ title: " " }), [b], { timeoutMs: 8000 })).resolves.toEqual([]);
        expect(b.search).not.toHaveBeenCalled();
    });
});

describe("remembered alternates", () => {
    beforeEach(() => {
        mockStore.clear();
    });

    it("remembers the source that played and forgets it on request", () => {
        const original = song();
        const alternate = song({ id: "b1", platform: "源B" });
        rememberAlternate(original, alternate);
        expect(getRememberedAlternate(original)).toMatchObject({ id: "b1", platform: "源B" });

        forgetAlternate(original);
        expect(getRememberedAlternate(original)).toBeNull();
    });

    it("drops a remembered source that no longer matches the song", () => {
        const original = song();
        rememberAlternate(original, song({ id: "b1", platform: "源B" }));
        // 原来源更新了歌曲信息（例如改成了 Live 版）
        expect(getRememberedAlternate(song({ title: "晴天 (Live)" }))).toBeNull();
    });

    it("keeps only the most recent 300 songs", () => {
        for (let index = 0; index < 305; index++) {
            rememberAlternate(song({ id: `o${index}` }), song({ id: `b${index}`, platform: "源B" }), index);
        }
        expect(getRememberedAlternate(song({ id: "o4" }))).toBeNull();
        expect(getRememberedAlternate(song({ id: "o5" }))).toMatchObject({ id: "b5" });
        expect(getRememberedAlternate(song({ id: "o304" }))).toMatchObject({ id: "b304" });
    });
});
