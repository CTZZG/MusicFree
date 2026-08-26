/**
 * 这组测试锁的是「用哪个路由名判定播放条显隐」，而不是策略函数本身。
 *
 * 回归背景：播放条的显隐曾直接读已提交的 routeName，而那个值要等
 * transitionEnd 才更新（为了让液态玻璃背板在转场结束后才采样）。结果进入
 * 播放详情页时，播放条会在整个转场动画期间继续压在底部。纯策略测试覆盖不到
 * 这种缺陷——策略的输入输出都是对的，错的是喂给它哪个路由名。
 */
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

// @/core/router 会拉进未转译的 @react-navigation ESM，这里只需要它的常量。
jest.mock("@/core/router", () => ({
    ROUTE_PATH: {
        HOME: "home",
        SEARCH_PAGE: "search-page",
        LOCAL_SHEET_DETAIL: "local-sheet-detail",
        ALBUM_DETAIL: "album-detail",
        ARTIST_DETAIL: "artist-detail",
        TOP_LIST: "top-list",
        TOP_LIST_DETAIL: "top-list-detail",
        LOCAL: "local",
        DOWNLOADING: "downloading",
        SEARCH_MUSIC_LIST: "search-music-list",
        RECOMMEND_SHEETS: "recommend-sheets",
        PLUGIN_SHEET_DETAIL: "plugin-sheet-detail",
        HISTORY: "history",
        SHEET_BROWSER: "sheet-browser",
        SMART_SHEETS: "smart-sheets",
        SMART_SHEET_DETAIL: "smart-sheet-detail",
        MUSIC_DETAIL: "music-detail",
    },
}));

jest.mock("@/core/theme", () => ({
    __esModule: true,
    default: { useTheme: () => ({ id: "p-dark" }) },
}));

jest.mock("@/core/trackPlayer", () => ({
    useCurrentMusic: () => ({
        id: "1",
        platform: "test",
        title: "t",
        artist: "a",
    }),
}));

import {
    MusicBarLayoutProvider,
    useMusicBarLayoutState,
} from "../layoutState";

let observed: { visible: boolean; committedRoute: string } | null = null;

function Probe() {
    const { layout, routeName } = useMusicBarLayoutState();
    observed = { visible: layout.visible, committedRoute: routeName };
    return null;
}

function renderWith(props: {
    routeName: string;
    visibilityRouteName?: string;
}) {
    let tree: ReactTestRenderer | null = null;
    act(() => {
        tree = create(
            <MusicBarLayoutProvider
                routeName={props.routeName}
                visibilityRouteName={props.visibilityRouteName}
                transitionInProgress={false}>
                <Probe />
            </MusicBarLayoutProvider>,
        );
    });
    return tree as unknown as ReactTestRenderer;
}

describe("music bar visibility route", () => {
    beforeEach(() => {
        observed = null;
    });

    it("hides the bar as soon as navigation targets the detail screen", () => {
        // 转场刚开始：已提交路由仍是 home，但目标已是 music-detail。
        // 播放条必须立刻隐藏，不能等到 transitionEnd。
        const tree = renderWith({
            routeName: "home",
            visibilityRouteName: "music-detail",
        });
        expect(observed).toEqual({ visible: false, committedRoute: "home" });
        act(() => tree.unmount());
    });

    it("keeps the bar while transitioning between two supported routes", () => {
        const tree = renderWith({
            routeName: "home",
            visibilityRouteName: "history",
        });
        expect(observed).toEqual({ visible: true, committedRoute: "home" });
        act(() => tree.unmount());
    });

    it("falls back to the committed route when no staged route is given", () => {
        const tree = renderWith({ routeName: "music-detail" });
        expect(observed).toEqual({
            visible: false,
            committedRoute: "music-detail",
        });
        act(() => tree.unmount());
    });
});
