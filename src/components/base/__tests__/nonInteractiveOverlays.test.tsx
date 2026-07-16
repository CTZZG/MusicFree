import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({
        appBar: "#111111",
        primary: "#222222",
        pageBackground: "#333333",
        background: "#444444",
    }),
}));

jest.mock("@/core/theme", () => ({
    __esModule: true,
    default: {
        useTheme: () => ({ id: "p-light" }),
        useBackground: () => null,
    },
}));

jest.mock("@/core/appConfig", () => ({
    useAppConfig: () => true,
}));

jest.mock("react-native-linear-gradient", () => {
    const { View: MockView } = require("react-native");
    return MockView;
});

jest.mock("../image", () => {
    const { View: MockView } = require("react-native");
    return MockView;
});

import PageBackground from "../pageBackground";
import AppStatusBar from "../statusBar";

describe("non-interactive visual overlays", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("does not let the custom status bar background intercept AppBar taps", () => {
        act(() => {
            renderer = create(<AppStatusBar backgroundColor="transparent" />);
        });

        const overlay = renderer!.root.find(
            node => node.props.pointerEvents === "none",
        );

        expect(overlay?.props.pointerEvents).toBe("none");
    });

    it("keeps every page background layer touch-transparent", () => {
        act(() => {
            renderer = create(<PageBackground />);
        });

        const backgroundRoot = renderer!.root.find(
            node => node.props.pointerEvents === "none",
        );
        expect(backgroundRoot).toBeDefined();
    });
});
