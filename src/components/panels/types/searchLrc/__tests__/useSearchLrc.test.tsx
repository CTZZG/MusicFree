import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native-reanimated", () => ({
    Easing: {
        exp: jest.fn(),
        out: jest.fn((easing: unknown) => easing),
    },
}));

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getByHash: jest.fn(),
        getSearchablePlugins: jest.fn(),
    },
}));

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    errorLog: jest.fn(),
}));

jest.mock("immer", () => ({
    produce:
        <T,>(recipe: (draft: T) => T | void) =>
        (base: T) => {
            const draft = JSON.parse(JSON.stringify(base)) as T;
            return recipe(draft) ?? draft;
        },
}));

import PluginManager from "@/core/pluginManager";
import searchResultStore from "../searchResultStore";
import useSearchLrc from "../useSearchLrc";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

describe("useSearchLrc request generations", () => {
    let renderer: ReactTestRenderer | undefined;
    let search!: ReturnType<typeof useSearchLrc>;

    function Probe() {
        search = useSearchLrc();
        return null;
    }

    beforeEach(() => {
        searchResultStore.setValue({ data: {} });
        act(() => {
            renderer = create(<Probe />);
        });
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
        searchResultStore.setValue({ data: {} });
    });

    it("keeps concurrent requests for different plugins independent", async () => {
        const first = deferred<any>();
        const second = deferred<any>();
        const plugins = {
            "plugin-a": {
                hash: "plugin-a",
                name: "A",
                instance: { platform: "a" },
                methods: { search: jest.fn(() => first.promise) },
            },
            "plugin-b": {
                hash: "plugin-b",
                name: "B",
                instance: { platform: "b" },
                methods: { search: jest.fn(() => second.promise) },
            },
        } as const;
        jest.mocked(PluginManager.getByHash).mockImplementation(
            hash => plugins[hash as keyof typeof plugins] as any,
        );

        act(() => {
            void search("song", 1, "plugin-a");
            void search(undefined, undefined, "plugin-b");
        });

        await act(async () => {
            second.resolve({ data: [{ id: "b" }] });
            first.resolve({ data: [{ id: "a" }] });
            await Promise.resolve();
        });

        expect(searchResultStore.getValue().data["plugin-a"].data[0].id).toBe(
            "a",
        );
        expect(searchResultStore.getValue().data["plugin-b"].data[0].id).toBe(
            "b",
        );
    });

    it("ignores an older response for the same plugin and query", async () => {
        const first = deferred<any>();
        const second = deferred<any>();
        const plugin = {
            hash: "plugin-a",
            name: "A",
            instance: { platform: "a" },
            methods: {
                search: jest
                    .fn()
                    .mockReturnValueOnce(first.promise)
                    .mockReturnValueOnce(second.promise),
            },
        };
        jest.mocked(PluginManager.getByHash).mockReturnValue(plugin as any);

        act(() => {
            void search("song", 1, "plugin-a");
            void search("song", 1, "plugin-a");
        });

        await act(async () => {
            second.resolve({ data: [{ id: "new" }] });
            first.resolve({ data: [{ id: "old" }] });
            await Promise.resolve();
        });

        expect(searchResultStore.getValue().data["plugin-a"].data[0].id).toBe(
            "new",
        );
    });
});
