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
    },
}));

import PluginManager from "@/core/pluginManager";
import useTopListDetail from "../useTopListDetail";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

const oldTopList = {
    id: "old",
    platform: "old-platform",
    title: "Old",
} as IMusic.IMusicSheetItemBase;
const nextTopList = {
    id: "next",
    platform: "next-platform",
    title: "Next",
} as IMusic.IMusicSheetItemBase;

describe("useTopListDetail", () => {
    let renderer: ReactTestRenderer | undefined;
    let latestResult: ReturnType<typeof useTopListDetail>;

    function Probe(props: {
        item: IMusic.IMusicSheetItemBase;
        pluginHash: string;
    }) {
        latestResult = useTopListDetail(props.item, props.pluginHash);
        return null;
    }

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("ignores a late response after the route switches", async () => {
        const oldRequest = deferred<any>();
        const nextRequest = deferred<any>();
        const getTopListDetail = jest
            .fn()
            .mockReturnValueOnce(oldRequest.promise)
            .mockReturnValueOnce(nextRequest.promise);
        jest.mocked(PluginManager.getByHash).mockReturnValue({
            methods: { getTopListDetail },
        } as any);

        act(() => {
            renderer = create(
                <Probe item={oldTopList} pluginHash="old-plugin" />,
            );
        });
        act(() => {
            renderer!.update(
                <Probe item={nextTopList} pluginHash="next-plugin" />,
            );
        });

        await act(async () => {
            oldRequest.resolve({
                topListItem: oldTopList,
                musicList: [{ id: "old-song" }],
                isEnd: true,
            });
            await Promise.resolve();
        });
        expect(latestResult[0]?.id).toBe(nextTopList.id);
        expect(latestResult[0]?.musicList).toBeUndefined();

        await act(async () => {
            nextRequest.resolve({
                topListItem: nextTopList,
                musicList: [{ id: "next-song" }],
                isEnd: true,
            });
            await Promise.resolve();
        });
        expect(latestResult[0]?.musicList?.[0]?.id).toBe("next-song");
    });

    it("does not start duplicate page requests while one is pending", () => {
        const request = deferred<any>();
        const getTopListDetail = jest.fn(() => request.promise);
        jest.mocked(PluginManager.getByHash).mockReturnValue({
            methods: { getTopListDetail },
        } as any);

        act(() => {
            renderer = create(
                <Probe item={oldTopList} pluginHash="old-plugin" />,
            );
        });
        act(() => {
            latestResult[2]();
            latestResult[2]();
        });

        expect(getTopListDetail).toHaveBeenCalledTimes(1);
    });
});
