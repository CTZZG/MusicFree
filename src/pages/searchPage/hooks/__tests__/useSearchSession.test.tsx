import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

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

interface IMockRequest {
    hash: string;
    query: string;
    page: number;
    type: string;
    resolve(result: unknown): void;
    reject(error: unknown): void;
}

const mockRequests: IMockRequest[] = [];
const mockSearchablePlugins: any[] = [];

function mockPlugin(hash: string) {
    return {
        hash,
        name: `plugin-${hash}`,
        instance: { platform: hash },
        methods: {
            search: (query: string, page: number, type: string) =>
                new Promise((resolve, reject) => {
                    mockRequests.push({
                        hash,
                        query,
                        page,
                        type,
                        resolve,
                        reject,
                    });
                }),
        },
    };
}

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getSearchablePlugins: () => mockSearchablePlugins,
        getByHash: (hash: string) =>
            mockSearchablePlugins.find(plugin => plugin.hash === hash),
    },
}));

import searchSession, {
    SEARCH_SOURCE_TIMEOUT_MS,
    type ISearchSourceResult,
} from "@/core/search";
import { getDefaultStore } from "jotai";
import { editingAtom, PageStatus } from "../../store/atoms";
import {
    usePageStatus,
    useSearchSourceResult,
    useSubmitSearch,
} from "../useSearchSession";

async function flush() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

function musicPage(ids: string[]) {
    return {
        isEnd: true,
        data: ids.map(id => ({ id, platform: "test" })),
    };
}

describe("search page model", () => {
    let renderer: ReactTestRenderer | undefined;
    let status: PageStatus | undefined;
    let submitSearch: ReturnType<typeof useSubmitSearch>;
    let sourceAResult: ISearchSourceResult<"music"> | undefined;
    let sourceARenders = 0;

    function StatusProbe() {
        status = usePageStatus();
        submitSearch = useSubmitSearch();
        return null;
    }

    function SourceAProbe() {
        sourceAResult = useSearchSourceResult("music", "a");
        sourceARenders += 1;
        return null;
    }

    beforeEach(() => {
        jest.useFakeTimers();
        mockRequests.length = 0;
        mockSearchablePlugins.splice(
            0,
            mockSearchablePlugins.length,
            mockPlugin("a"),
            mockPlugin("b"),
        );
        searchSession.reset();
        getDefaultStore().set(editingAtom, true);
        sourceARenders = 0;
        act(() => {
            renderer = create(
                <>
                    <StatusProbe />
                    <SourceAProbe />
                </>,
            );
        });
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("goes from history to loading to results once the first source answers", async () => {
        expect(status).toBe(PageStatus.EDITING);

        act(() => {
            submitSearch("hello");
        });
        expect(status).toBe(PageStatus.SEARCHING);
        expect(
            mockRequests.map(item => [item.hash, item.query, item.page]),
        ).toEqual([
            ["a", "hello", 1],
            ["b", "hello", 1],
        ]);

        await act(async () => {
            mockRequests[0].resolve(musicPage(["a1"]));
            await flush();
        });
        expect(status).toBe(PageStatus.RESULT);
        expect(sourceAResult?.data).toHaveLength(1);
    });

    it("re-renders a source's view only when that source changes", async () => {
        act(() => {
            submitSearch("hello");
        });
        const rendersAfterStart = sourceARenders;

        await act(async () => {
            mockRequests[1].resolve(musicPage(["b1", "b2"]));
            await flush();
        });
        expect(sourceARenders).toBe(rendersAfterStart);

        await act(async () => {
            mockRequests[0].resolve(musicPage(["a1"]));
            await flush();
        });
        expect(sourceARenders).toBe(rendersAfterStart + 1);
    });

    it("keeps other results while a timed-out source is retried on its own", async () => {
        act(() => {
            submitSearch("hello");
        });
        await act(async () => {
            mockRequests[0].resolve(musicPage(["a1"]));
            await flush();
        });
        await act(async () => {
            jest.advanceTimersByTime(SEARCH_SOURCE_TIMEOUT_MS);
            await flush();
        });
        expect(searchSession.getResult("music", "b")?.failure?.kind).toBe(
            "timeout",
        );

        act(() => {
            searchSession.retry("music", "b");
        });
        expect(mockRequests).toHaveLength(3);
        expect(mockRequests[2]).toMatchObject({ hash: "b", page: 1 });
        expect(sourceAResult?.data).toHaveLength(1);
    });

    it("shows history while editing and resumes on the next submit", async () => {
        act(() => {
            submitSearch("hello");
        });
        act(() => {
            getDefaultStore().set(editingAtom, true);
        });
        expect(status).toBe(PageStatus.EDITING);

        act(() => {
            submitSearch("world");
        });
        expect(status).toBe(PageStatus.SEARCHING);
        expect(mockRequests.slice(2).map(item => item.query)).toEqual([
            "world",
            "world",
        ]);
    });

    it("reports when no plugin can search", () => {
        mockSearchablePlugins.length = 0;

        act(() => {
            submitSearch("hello");
        });

        expect(status).toBe(PageStatus.NO_PLUGIN);
        expect(mockRequests).toHaveLength(0);
    });
});
