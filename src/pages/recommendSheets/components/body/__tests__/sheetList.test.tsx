import React from "react";
import {
    act,
    create,
    ReactTestRenderer,
} from "react-test-renderer";

const mockUseRecommendSheets = jest.fn(
    (_pluginHash: string, _tag: ICommon.IUnique) => [
        jest.fn(),
        [],
        0,
    ],
);

jest.mock("../../../hooks/useRecommendSheets", () => ({
    __esModule: true,
    default: (pluginHash: string, tag: ICommon.IUnique) =>
        mockUseRecommendSheets(pluginHash, tag),
}));
jest.mock("@shopify/flash-list", () => ({
    FlashList: () => null,
}));
jest.mock("@/hooks/useOrientation", () => ({
    __esModule: true,
    default: () => "vertical",
}));
jest.mock("@/components/musicBar/useMusicBarFloatingOffset", () => ({
    __esModule: true,
    default: () => 0,
}));
jest.mock("@/components/mediaItem/sheetItem", () => () => null);
jest.mock("@/components/base/listEmpty", () => () => null);
jest.mock("@/components/base/listFooter", () => () => null);

import SheetList from "../sheetList";

describe("recommend SheetList memoization", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("rerenders when request fields change under the same tag id", () => {
        const firstTag = {
            id: "same",
            category: "old",
        } as ICommon.IUnique;
        const changedTag = {
            id: "same",
            category: "new",
        } as ICommon.IUnique;

        act(() => {
            renderer = create(
                <SheetList pluginHash="plugin" tag={firstTag} />,
            );
        });
        act(() => {
            renderer!.update(
                <SheetList pluginHash="plugin" tag={changedTag} />,
            );
        });

        expect(mockUseRecommendSheets).toHaveBeenCalledTimes(2);
        expect(mockUseRecommendSheets).toHaveBeenLastCalledWith(
            "plugin",
            changedTag,
        );
    });
});
