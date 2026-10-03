import React, { createRef } from "react";
import { StyleSheet, View } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockMaterial = {
    blur: true,
    frostColor: "rgba(249, 249, 249, 0.55)",
};

jest.mock("../glassMaterial", () => ({
    getGlassMaterial: () => mockMaterial,
}));

jest.mock("expo-blur", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    function MockBlurView(props: any) {
        return mockReact.createElement(MockView, props);
    }
    return { BlurView: MockBlurView };
});

jest.mock("@/core/theme", () => ({
    __esModule: true,
    default: { useTheme: () => ({ dark: false }) },
}));

import GlassBackdrop from "../glassBackdrop";

const { BlurView } = jest.requireMock("expo-blur");

describe("GlassBackdrop", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("blurs the given target with the GPU blur method", () => {
        mockMaterial.blur = true;
        const target = createRef<View>();

        act(() => {
            renderer = create(<GlassBackdrop blurTarget={target} />);
        });

        const blur = renderer!.root.findByType(BlurView);
        // 没有 blurTarget，expo-blur 在 Android 上只会画一层半透明色
        expect(blur.props.blurTarget).toBe(target);
        expect(blur.props.blurMethod).toBe("dimezisBlurViewSdk31Plus");
    });

    it("draws only the frost when it cannot blur", () => {
        mockMaterial.blur = false;

        act(() => {
            renderer = create(<GlassBackdrop />);
        });

        expect(renderer!.root.findAllByType(BlurView)).toHaveLength(0);
        const frost = renderer!.root.findAll(
            node =>
                typeof node.type === "string" &&
                StyleSheet.flatten(node.props.style)?.backgroundColor ===
                    mockMaterial.frostColor,
        );
        expect(frost).toHaveLength(1);
    });
});
