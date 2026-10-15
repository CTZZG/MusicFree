/**
 * 性能基线（e2e/perf.sh）的搜索时间点：开始、第一个有结果的来源返回、所有来源的
 * 第一页都返回。只记这次搜索的第一页；被新搜索取代的、翻页的、其他类型的不算。
 */
jest.mock("react-native-reanimated", () => ({
    Easing: {
        exp: jest.fn(),
        out: jest.fn((easing: unknown) => easing),
    },
}));
jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
    trace: jest.fn(),
}));
jest.mock("@/utils/perfMark", () => ({ perfMark: jest.fn() }));

import { perfMark } from "@/utils/perfMark";
import {
    ISearchSource,
    ISearchSourceProvider,
    SearchSession,
} from "../searchSession";

type AnySearchResult = IPlugin.ISearchResult<ICommon.SupportMediaType>;

function createSource(hash: string) {
    const requests: Array<{
        page: number;
        type: ICommon.SupportMediaType;
        resolve(result: AnySearchResult | null): void;
        reject(error: unknown): void;
    }> = [];
    const source: ISearchSource = {
        hash,
        name: `source-${hash}`,
        search: ((_query: string, page: number, type: ICommon.SupportMediaType) =>
            new Promise<AnySearchResult | null>((resolve, reject) => {
                requests.push({ page, type, resolve, reject });
            })) as unknown as ISearchSource["search"],
    };
    return { source, requests };
}

function provider(sources: ISearchSource[]): ISearchSourceProvider {
    return {
        getSearchableSources: () => sources,
        getSourceByHash: hash => sources.find(item => item.hash === hash),
    };
}

function resultPage(ids: string[], isEnd = false): AnySearchResult {
    return { isEnd, data: ids.map(id => ({ id, platform: "test" })) as any };
}

async function flush() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

function marks() {
    return (perfMark as jest.Mock).mock.calls.map(([name, detail]) => [
        name,
        detail,
    ]);
}

beforeEach(() => {
    (perfMark as jest.Mock).mockClear();
});

describe("search perf marks", () => {
    it("marks start, the first source with results and the last source", async () => {
        const a = createSource("a");
        const b = createSource("b");
        const c = createSource("c");
        const session = new SearchSession(
            provider([a.source, b.source, c.source]),
        );

        session.start("tone");
        expect(marks()).toEqual([["search-start", { session: 1, sources: 3 }]]);

        // 空结果和失败都不算“第一个结果”
        b.requests[0].resolve(resultPage([], true));
        a.requests[0].reject(new Error("boom"));
        await flush();
        expect(marks()).toHaveLength(1);

        c.requests[0].resolve(resultPage(["x"]));
        await flush();
        expect(marks().slice(1)).toEqual([
            ["search-first-result", { session: 1 }],
            ["search-done", { session: 1, anyResults: true }],
        ]);

        // 之后翻页、看其他类型的结果都不再记
        session.loadMore("music", "c");
        session.ensureLoaded("album", "a");
        await flush();
        c.requests[1].resolve(resultPage(["y"]));
        a.requests[1].resolve(resultPage(["z"]));
        await flush();
        expect(marks()).toHaveLength(3);
    });

    it("marks done without a first result when every source comes back empty", async () => {
        const a = createSource("a");
        const session = new SearchSession(provider([a.source]));
        session.start("nothing");
        a.requests[0].resolve(resultPage([], true));
        await flush();
        expect(marks()).toEqual([
            ["search-start", { session: 1, sources: 1 }],
            ["search-done", { session: 1, anyResults: false }],
        ]);
    });

    it("does not count another type's first page toward the search", async () => {
        const a = createSource("a");
        const b = createSource("b");
        const session = new SearchSession(provider([a.source, b.source]));
        session.start("tone");
        session.ensureLoaded("album", "a");
        a.requests[1].resolve(resultPage(["album"]));
        await flush();
        // a 的单曲第一页还没回来，不能算 done，也不能算第一个（单曲）结果
        expect(marks()).toHaveLength(1);
        a.requests[0].resolve(resultPage(["x"]));
        b.requests[0].resolve(resultPage([], true));
        await flush();
        expect(marks().map(([name]) => name)).toEqual([
            "search-start",
            "search-first-result",
            "search-done",
        ]);
    });

    it("ignores results of a search that a newer one replaced", async () => {
        const a = createSource("a");
        const session = new SearchSession(provider([a.source]));
        session.start("old");
        session.start("new");
        a.requests[0].resolve(resultPage(["stale"]));
        await flush();
        expect(marks().map(([name]) => name)).toEqual([
            "search-start",
            "search-start",
        ]);
        a.requests[1].resolve(resultPage(["fresh"]));
        await flush();
        expect(marks().slice(2)).toEqual([
            ["search-first-result", { session: 2 }],
            ["search-done", { session: 2, anyResults: true }],
        ]);
    });
});
