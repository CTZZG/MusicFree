import React from "react";
import { act, create } from "react-test-renderer";
import { Text, View } from "react-native";

jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    default: { Text: require("react-native").Text, View: require("react-native").View, createAnimatedComponent: (x: unknown) => x },
    cancelAnimation: jest.fn(),
    Easing: { inOut: () => jest.fn(), out: () => jest.fn(), cubic: jest.fn(), ease: jest.fn() },
    interpolate: (value: number) => value,
    interpolateColor: () => "white",
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (value: unknown) => ({ value }),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
}));
jest.mock("@/core/lyricManager", () => ({ getCurrentPositionMsShared: () => ({ value: 300 }) }));
jest.mock("@/core/appConfig", () => ({ useAppConfig: () => true }));
jest.mock("@/hooks/useColors", () => ({ __esModule: true, default: () => ({ primary: "white" }) }));

import LyricItem from "../lyricItem";

it("uses the original long word duration while retaining each character's timing", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
        tree = create(<LyricItem highlight lines={[{
            key: "original", text: "Stay", primary: true, hasWordByWord: true,
            words: [{ text: "Stay", startTime: 0, duration: 2400 }],
        }]} />);
    });
    const first = tree.root.findAll(node => (node.type as unknown) === Text && node.props.children === "S")[0];
    expect(first).toBeDefined();
    const animated = first.props.style.find((style: { textShadowRadius?: number }) =>
        typeof style?.textShadowRadius === "number" && style.textShadowRadius > 4,
    );
    expect(animated.textShadowRadius).toBeCloseTo(6);
    expect(tree.root.findAll(node => (node.type as unknown) === View).length).toBeGreaterThan(0);
    act(() => tree.unmount());
});
