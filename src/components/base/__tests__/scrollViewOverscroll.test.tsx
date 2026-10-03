/**
 * patches/react-native+0.85.3.patch：所有 ScrollView（含 FlatList、SectionList、
 * FlashList 和手势库的 ScrollView）在 Android 上默认不做越界拉伸/回弹。
 *
 * 回弹还没结束时，原生 ScrollView.onInterceptTouchEvent 会把下一次按下当成
 * 「停住回弹」拦下来，里面的按钮收不到点击：外观设置滚到底后，封面样式要点两次
 * 才能切换。这里渲染真实的 ScrollView（jest 预设默认把它换成了桩），确认交给
 * 原生视图的属性。
 */
jest.unmock("react-native/Libraries/Components/ScrollView/ScrollView");

import React from "react";
import { FlatList, ScrollView } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

function nativeOverScrollModes(renderer: ReactTestRenderer) {
    return renderer.root
        .findAll(
            node =>
                typeof node.type === "string" &&
                "onScrollBeginDrag" in node.props,
        )
        .map(node => node.props.overScrollMode);
}

describe("ScrollView overscroll default", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("turns overscroll off unless a screen asks for it", () => {
        act(() => {
            renderer = create(<ScrollView />);
        });
        expect(nativeOverScrollModes(renderer!)).toEqual(["never"]);
    });

    it("keeps an explicit choice", () => {
        act(() => {
            renderer = create(<ScrollView overScrollMode="always" />);
        });
        expect(nativeOverScrollModes(renderer!)).toEqual(["always"]);
    });

    it("applies to lists built on ScrollView", () => {
        act(() => {
            renderer = create(
                <FlatList
                    data={["a", "b"]}
                    renderItem={() => null}
                    keyExtractor={item => item}
                />,
            );
        });
        expect(nativeOverScrollModes(renderer!)).toEqual(["never"]);
    });
});
