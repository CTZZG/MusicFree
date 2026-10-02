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

import { RequestStateCode } from "@/constants/commonConst";
import { errorLog } from "@/utils/log";
import {
    ISearchSource,
    ISearchSourceProvider,
    ISearchSourceResult,
    SearchSession,
} from "../searchSession";

const TIMEOUT_MS = 1_000;

type AnySearchResult = IPlugin.ISearchResult<ICommon.SupportMediaType>;

interface IRecordedSearch {
    query: string;
    page: number;
    type: ICommon.SupportMediaType;
    resolve(result: AnySearchResult | null): void;
    reject(error: unknown): void;
}

function createSource(
    hash: string,
    defaultSearchType?: ICommon.SupportMediaType,
) {
    const requests: IRecordedSearch[] = [];
    const search = jest.fn(
        (query: string, page: number, type: ICommon.SupportMediaType) =>
            new Promise<AnySearchResult | null>((resolve, reject) => {
                requests.push({ query, page, type, resolve, reject });
            }),
    );
    const source: ISearchSource = {
        hash,
        name: `source-${hash}`,
        defaultSearchType,
        search: search as unknown as ISearchSource["search"],
    };
    return { source, search, requests };
}

function createProvider(sources: ISearchSource[]) {
    let available = [...sources];
    const provider: ISearchSourceProvider & { remove(hash: string): void } = {
        getSearchableSources: () => available,
        getSourceByHash: hash => available.find(item => item.hash === hash),
        remove: hash => {
            available = available.filter(item => item.hash !== hash);
        },
    };
    return provider;
}

function resultPage(itemIds: string[], isEnd = false): AnySearchResult {
    return {
        isEnd,
        data: itemIds.map(id => ({ id, platform: "test" })) as any,
    };
}

function idsOf(result?: ISearchSourceResult) {
    return result?.data.map(item => (item as ICommon.IUnique).id);
}

async function flush() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

describe("SearchSession", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("shows a fast source first and retries only the source that timed out", async () => {
        const fast = createSource("fast");
        const slow = createSource("slow");
        const session = new SearchSession(
            createProvider([fast.source, slow.source]),
            { timeoutMs: TIMEOUT_MS },
        );

        session.start("hello");
        expect(session.getSnapshot().phase).toBe("pending");

        fast.requests[0].resolve(resultPage(["f1", "f2"], true));
        await flush();

        expect(session.getSnapshot().phase).toBe("settled");
        expect(idsOf(session.getResult("music", "fast"))).toEqual(["f1", "f2"]);
        expect(session.getResult("music", "slow")?.state).toBe(
            RequestStateCode.PENDING_FIRST_PAGE,
        );

        jest.advanceTimersByTime(TIMEOUT_MS);
        await flush();

        expect(session.getResult("music", "slow")).toMatchObject({
            state: RequestStateCode.ERROR,
            failure: { kind: "timeout", message: "搜索超时", page: 1 },
        });

        const fastResult = session.getResult("music", "fast");
        session.retry("music", "slow");

        expect(slow.search).toHaveBeenCalledTimes(2);
        expect(fast.search).toHaveBeenCalledTimes(1);
        expect(session.getResult("music", "fast")).toBe(fastResult);
        expect(session.getResult("music", "slow")?.state).toBe(
            RequestStateCode.PENDING_FIRST_PAGE,
        );

        // 被放弃的第一次请求迟到返回，不影响重试中的请求
        slow.requests[0].resolve(resultPage(["late"], true));
        await flush();
        expect(session.getResult("music", "slow")?.state).toBe(
            RequestStateCode.PENDING_FIRST_PAGE,
        );

        slow.requests[1].resolve(resultPage(["s1"], true));
        await flush();
        expect(idsOf(session.getResult("music", "slow"))).toEqual(["s1"]);
    });

    it("keeps a new query clean when the previous query finishes last", async () => {
        const source = createSource("a");
        const session = new SearchSession(createProvider([source.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("A");
        session.start("B");
        expect(source.requests.map(item => item.query)).toEqual(["A", "B"]);

        source.requests[1].resolve(resultPage(["b1"], true));
        await flush();
        source.requests[0].resolve(resultPage(["a1"], true));
        await flush();

        expect(session.getSnapshot().query).toBe("B");
        expect(session.getResult("music", "a")).toMatchObject({
            query: "B",
            state: RequestStateCode.FINISHED,
        });
        expect(idsOf(session.getResult("music", "a"))).toEqual(["b1"]);
    });

    it("drops a late failure from the previous query", async () => {
        const source = createSource("a");
        const session = new SearchSession(createProvider([source.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("A");
        session.start("B");
        source.requests[0].reject(new Error("A failed"));
        await flush();

        expect(session.getSnapshot().phase).toBe("pending");
        expect(session.getResult("music", "a")).toMatchObject({
            query: "B",
            state: RequestStateCode.PENDING_FIRST_PAGE,
        });
        expect(errorLog).not.toHaveBeenCalled();
    });

    it("does not leak another category's results from the previous query", async () => {
        const source = createSource("a");
        const session = new SearchSession(createProvider([source.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("A");
        session.ensureLoaded("album", "a");
        session.start("B");

        source.requests[1].resolve(resultPage(["album-of-A"], true));
        await flush();
        expect(session.getResult("album", "a")).toBeUndefined();

        session.ensureLoaded("album", "a");
        expect(source.requests[3]).toMatchObject({
            query: "B",
            page: 1,
            type: "album",
        });
    });

    it("retries a failed page without dropping or repeating pages", async () => {
        const source = createSource("a");
        const session = new SearchSession(createProvider([source.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        source.requests[0].resolve(resultPage(["1a", "1b"]));
        await flush();
        expect(session.getResult("music", "a")?.state).toBe(
            RequestStateCode.PARTLY_DONE,
        );

        session.loadMore("music", "a");
        expect(source.requests[1].page).toBe(2);
        expect(session.getResult("music", "a")).toMatchObject({
            state: RequestStateCode.PENDING_REST_PAGE,
            page: 1,
        });
        expect(idsOf(session.getResult("music", "a"))).toEqual(["1a", "1b"]);

        source.requests[1].reject(new Error("network down"));
        await flush();
        expect(session.getResult("music", "a")).toMatchObject({
            state: RequestStateCode.ERROR,
            page: 1,
            failure: { kind: "error", message: "network down", page: 2 },
        });
        expect(idsOf(session.getResult("music", "a"))).toEqual(["1a", "1b"]);

        // 失败的页不会被“加载更多”跳过
        session.loadMore("music", "a");
        expect(source.search).toHaveBeenCalledTimes(2);

        session.retry("music", "a");
        expect(source.requests[2].page).toBe(2);
        source.requests[2].resolve(resultPage(["2a"]));
        await flush();

        session.loadMore("music", "a");
        expect(source.requests[3].page).toBe(3);
        source.requests[3].resolve(resultPage(["3a"], true));
        await flush();

        expect(idsOf(session.getResult("music", "a"))).toEqual([
            "1a",
            "1b",
            "2a",
            "3a",
        ]);
        expect(session.getResult("music", "a")).toMatchObject({
            state: RequestStateCode.FINISHED,
            page: 3,
        });

        session.loadMore("music", "a");
        expect(source.search).toHaveBeenCalledTimes(4);
    });

    it("loads each category of each source independently and only once", async () => {
        const a = createSource("a");
        const b = createSource("b", "album");
        const session = new SearchSession(
            createProvider([a.source, b.source]),
            { timeoutMs: TIMEOUT_MS },
        );

        session.start("q");
        // 未指定类型时，每个来源先搜索自己的默认类型
        expect(a.requests[0].type).toBe("music");
        expect(b.requests[0].type).toBe("album");

        session.ensureLoaded("music", "a");
        session.ensureLoaded("album", "a");
        session.ensureLoaded("album", "a");
        expect(a.search).toHaveBeenCalledTimes(2);
        expect(a.requests[1]).toMatchObject({
            query: "q",
            page: 1,
            type: "album",
        });

        a.requests[1].resolve(resultPage(["a-album"], true));
        await flush();

        expect(idsOf(session.getResult("album", "a"))).toEqual(["a-album"]);
        expect(session.getResult("music", "a")?.state).toBe(
            RequestStateCode.PENDING_FIRST_PAGE,
        );
        expect(session.getResult("album", "b")?.state).toBe(
            RequestStateCode.PENDING_FIRST_PAGE,
        );
    });

    it("searches only the requested source and loads the others on demand", () => {
        const a = createSource("a");
        const b = createSource("b");
        const session = new SearchSession(
            createProvider([a.source, b.source]),
            { timeoutMs: TIMEOUT_MS },
        );

        session.start("q", { sourceHash: "b", type: "artist" });
        expect(a.search).not.toHaveBeenCalled();
        expect(b.requests[0]).toMatchObject({ type: "artist", page: 1 });

        session.ensureLoaded("artist", "a");
        expect(a.requests[0]).toMatchObject({
            query: "q",
            page: 1,
            type: "artist",
        });
    });

    it("reports when there is no source to search", () => {
        const empty = new SearchSession(createProvider([]));
        empty.start("q");
        expect(empty.getSnapshot().phase).toBe("no-source");

        const a = createSource("a");
        const scoped = new SearchSession(createProvider([a.source]));
        scoped.start("q", { sourceHash: "missing" });
        expect(scoped.getSnapshot().phase).toBe("no-source");

        scoped.ensureLoaded("music", "a");
        expect(a.search).not.toHaveBeenCalled();
    });

    it("explains a source that was removed during the search", async () => {
        const a = createSource("a");
        const provider = createProvider([a.source]);
        const session = new SearchSession(provider, { timeoutMs: TIMEOUT_MS });

        session.start("q");
        a.requests[0].reject(new Error("boom"));
        await flush();

        provider.remove("a");
        session.retry("music", "a");
        session.ensureLoaded("album", "a");

        expect(a.search).toHaveBeenCalledTimes(1);
        expect(session.getResult("music", "a")?.failure).toMatchObject({
            kind: "source-unavailable",
            page: 1,
        });
        expect(session.getResult("album", "a")?.failure?.kind).toBe(
            "source-unavailable",
        );
    });

    it("treats an empty response as a failure", async () => {
        const a = createSource("a");
        const session = new SearchSession(createProvider([a.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        a.requests[0].resolve(null);
        await flush();

        expect(session.getResult("music", "a")).toMatchObject({
            state: RequestStateCode.ERROR,
            failure: {
                kind: "invalid-result",
                message: "搜索结果为空",
                page: 1,
            },
        });
    });

    it("stops paging on an empty page even if the source claims more", async () => {
        const a = createSource("a");
        const session = new SearchSession(createProvider([a.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        a.requests[0].resolve(resultPage([], false));
        await flush();

        expect(session.getResult("music", "a")?.state).toBe(
            RequestStateCode.FINISHED,
        );
        session.loadMore("music", "a");
        expect(a.search).toHaveBeenCalledTimes(1);
    });

    it("turns a synchronous throw from a source into a failure", async () => {
        const thrower: ISearchSource = {
            hash: "t",
            name: "thrower",
            search: () => {
                throw new Error("sync failure");
            },
        };
        const session = new SearchSession(createProvider([thrower]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        await flush();

        expect(session.getSnapshot().phase).toBe("settled");
        expect(session.getResult("music", "t")?.failure).toEqual({
            kind: "error",
            message: "sync failure",
            page: 1,
        });
    });

    it("refreshes from the first page and abandons a pending next page", async () => {
        const a = createSource("a");
        const session = new SearchSession(createProvider([a.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        a.requests[0].resolve(resultPage(["1a"]));
        await flush();
        session.loadMore("music", "a");
        session.refresh("music", "a");

        expect(a.requests[2].page).toBe(1);
        expect(session.getResult("music", "a")).toMatchObject({
            state: RequestStateCode.PENDING_FIRST_PAGE,
            data: [],
        });

        a.requests[1].resolve(resultPage(["2a"]));
        await flush();
        a.requests[2].resolve(resultPage(["fresh"], true));
        await flush();

        expect(idsOf(session.getResult("music", "a"))).toEqual(["fresh"]);
    });

    it("does not send a duplicate request for a page that is already loading", () => {
        const a = createSource("a");
        const session = new SearchSession(createProvider([a.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        session.refresh("music", "a");
        session.ensureLoaded("music", "a");
        session.loadMore("music", "a");

        expect(a.search).toHaveBeenCalledTimes(1);
    });

    it("discards results and ignores actions after reset", async () => {
        const a = createSource("a");
        const session = new SearchSession(createProvider([a.source]), {
            timeoutMs: TIMEOUT_MS,
        });

        session.start("q");
        session.reset();
        expect(session.getSnapshot()).toMatchObject({
            phase: "idle",
            query: "",
        });

        a.requests[0].resolve(resultPage(["late"], true));
        await flush();
        expect(session.getResult("music", "a")).toBeUndefined();

        session.ensureLoaded("music", "a");
        session.loadMore("music", "a");
        session.retry("music", "a");
        session.refresh("music", "a");
        expect(a.search).toHaveBeenCalledTimes(1);
    });

    it("notifies subscribers and keeps untouched results referentially stable", async () => {
        const a = createSource("a");
        const b = createSource("b");
        const session = new SearchSession(
            createProvider([a.source, b.source]),
            { timeoutMs: TIMEOUT_MS },
        );
        const listener = jest.fn();
        const unsubscribe = session.subscribe(listener);

        session.start("q");
        expect(listener).toHaveBeenCalled();
        expect(session.getSnapshot().id).toBe(1);

        const before = session.getSnapshot();
        b.requests[0].resolve(resultPage(["b1"], true));
        await flush();
        const after = session.getSnapshot();

        expect(after).not.toBe(before);
        expect(after.results.music.a).toBe(before.results.music.a);
        expect(after.results.album).toBe(before.results.album);

        unsubscribe();
        listener.mockClear();
        session.reset();
        expect(listener).not.toHaveBeenCalled();
        expect(session.getSnapshot().id).toBe(2);
    });
});
