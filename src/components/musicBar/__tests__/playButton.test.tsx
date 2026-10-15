/**
 * 迷你播放器的播放暂停按钮：加载、缓冲中转圈的同时也要能按下暂停（以前转圈时按不了），
 * 其他状态照旧是播放或暂停。
 */
import React from "react";
import { ActivityIndicator } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

let mockState = "buffering";
const mockPlay = jest.fn(async () => undefined);
const mockPause = jest.fn(async () => undefined);

jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: { play: () => mockPlay(), pause: () => mockPause() },
    useMusicState: () => mockState,
}));
jest.mock("@/hooks/useColors", () => () => ({ musicBarText: "#fff" }));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/base/icon.tsx", () => "Icon");

import MiniPlayButton from "../playButton";

function render(state: string) {
    mockState = state;
    let tree: ReactTestRenderer | null = null;
    act(() => {
        tree = create(<MiniPlayButton />);
    });
    return tree as unknown as ReactTestRenderer;
}

function button(tree: ReactTestRenderer, label = "musicBar.playPause.a11y") {
    const found = tree.root.findAll(
        node =>
            node.props.accessibilityRole === "button" &&
            node.props.accessibilityLabel === label &&
            typeof node.props.onPress === "function",
    );
    expect(found.length).toBeGreaterThan(0);
    return found[0];
}

function icons(tree: ReactTestRenderer) {
    return tree.root.findAll(node => (node.type as unknown) === "Icon").map(node => node.props.name);
}

beforeEach(() => {
    mockPlay.mockClear();
    mockPause.mockClear();
});

it("pauses from the spinner while buffering and tells screen readers it is loading", async () => {
    const tree = render("buffering");
    expect(tree.root.findAll(node => node.type === (ActivityIndicator as unknown))).not.toHaveLength(0);
    expect(icons(tree)).toEqual(["pause"]);
    const loading = button(tree, "musicBar.pauseWhileLoading.a11y");
    expect(loading.props.accessibilityState).toEqual({ busy: true });

    await act(async () => {
        await loading.props.onPress();
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();
});

it.each([
    ["playing", "pause", mockPause],
    ["paused", "play", mockPlay],
    ["idle", "play", mockPlay],
])("shows a plain button when %s", async (state, icon, action) => {
    const tree = render(state);
    expect(tree.root.findAll(node => node.type === (ActivityIndicator as unknown))).toHaveLength(0);
    expect(icons(tree)).toEqual([icon]);
    expect(button(tree).props.accessibilityState).toBeUndefined();

    await act(async () => {
        await button(tree).props.onPress();
    });
    expect(action).toHaveBeenCalledTimes(1);
});
