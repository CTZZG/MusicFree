import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import HomeSectionEditor from "../homeSectionEditor";
import Config, { useAppConfig } from "@/core/appConfig";
jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: { setConfig: jest.fn() },
    useAppConfig: jest.fn(),
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({
        t: (key: string, args?: { title: string }) =>
            key + (args?.title ? `:${args.title}` : ""),
    }),
}));
jest.mock("@/components/base/themeText", () => "Text");

it("persists the actual up/down actions, handles edges and restores the selected home variant's defaults", () => {
    (useAppConfig as jest.Mock).mockImplementation(key =>
        key === "theme.useEnhancedHome" ? false : undefined,
    );
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(<HomeSectionEditor />);
    });
    const button = (label: string) =>
        tree.root.findAll(
            node =>
                node.props.accessibilityLabel === label &&
                typeof node.props.onPress === "function",
        )[0];
    expect(button("homeOrder.up:homeOrder.continue").props.disabled).toBe(true);
    act(() => button("homeOrder.down:homeOrder.continue").props.onPress());
    expect(Config.setConfig).toHaveBeenLastCalledWith("theme.homeSectionOrder", [
        "shortcuts",
        "continue",
        "recent",
        "discovery",
    ]);
    act(() => button("homeOrder.reset").props.onPress());
    expect(Config.setConfig).toHaveBeenLastCalledWith("theme.homeSectionOrder", [
        "continue",
        "shortcuts",
        "recent",
        "discovery",
    ]);
    act(() => tree.unmount());
});
