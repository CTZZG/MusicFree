import React from "react";
import {
    act,
    create,
    ReactTestRenderer,
} from "react-test-renderer";

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

jest.mock("@/utils/mediaUtils", () => ({
    resetMediaItem: (item: unknown) => item,
}));

import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import useRecommendSheets from "../useRecommendSheets";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const oldTag = { id: "old", title: "Old" } as ICommon.IUnique;
const nextTag = { id: "next", title: "Next" } as ICommon.IUnique;

describe("useRecommendSheets", () => {
    let renderer: ReactTestRenderer | undefined;
    let latestResult: ReturnType<typeof useRecommendSheets>;

    function Probe(props: { pluginHash: string; tag: ICommon.IUnique }) {
        latestResult = useRecommendSheets(props.pluginHash, props.tag);
        return null;
    }

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("does not start duplicate page requests while one is pending", () => {
        const operation = deferred<any>();
        const request = jest.fn(() => operation.promise);
        jest.mocked(PluginManager.getByHash).mockReturnValue({
            instance: { platform: "test" },
            methods: { getRecommendSheetsByTag: request },
        } as any);

        act(() => {
            renderer = create(
                <Probe pluginHash="plugin" tag={oldTag} />,
            );
        });
        act(() => {
            latestResult[0]();
            latestResult[0]();
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(oldTag, 1);
    });

    it("ignores resolve and reject from a previous tag", async () => {
        const oldOperation = deferred<any>();
        const nextOperation = deferred<any>();
        const request = jest
            .fn()
            .mockReturnValueOnce(oldOperation.promise)
            .mockReturnValueOnce(nextOperation.promise);
        jest.mocked(PluginManager.getByHash).mockReturnValue({
            instance: { platform: "test" },
            methods: { getRecommendSheetsByTag: request },
        } as any);

        act(() => {
            renderer = create(
                <Probe pluginHash="plugin" tag={oldTag} />,
            );
        });
        act(() => {
            renderer!.update(
                <Probe pluginHash="plugin" tag={nextTag} />,
            );
        });

        await act(async () => {
            oldOperation.reject(new Error("late failure"));
            await Promise.resolve();
        });
        expect(latestResult[2]).not.toBe(RequestStateCode.ERROR);
        expect(latestResult[1]).toEqual([]);

        await act(async () => {
            nextOperation.resolve({
                data: [{ id: "next-sheet" }],
                isEnd: true,
            });
            await Promise.resolve();
        });
        expect(latestResult[1]).toEqual([{ id: "next-sheet" }]);
        expect(latestResult[2]).toBe(RequestStateCode.FINISHED);
    });

    it("retries the same page after a failure", async () => {
        const request = jest
            .fn()
            .mockRejectedValueOnce(new Error("temporary"))
            .mockResolvedValueOnce({
                data: [{ id: "sheet" }],
                isEnd: true,
            });
        jest.mocked(PluginManager.getByHash).mockReturnValue({
            instance: { platform: "test" },
            methods: { getRecommendSheetsByTag: request },
        } as any);

        await act(async () => {
            renderer = create(
                <Probe pluginHash="plugin" tag={oldTag} />,
            );
            await Promise.resolve();
        });
        expect(latestResult[2]).toBe(RequestStateCode.ERROR);

        await act(async () => {
            await latestResult[0]();
        });
        expect(request.mock.calls.map(call => call[1])).toEqual([1, 1]);
        expect(latestResult[1]).toEqual([{ id: "sheet" }]);
    });
});
