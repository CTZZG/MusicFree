/**
 * ThemeText 按页面迁移到跟随系统字体：没登记的页面保持原样（不放大），
 * 登记过的页面、面板外面包了 followSystem 的 FontScaleScope，跟随系统。
 */
import React from "react";
import { Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import ThemeText from "../themeText";
import { FontScaleScope } from "../fontScaleScope";

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ text: "#000000" }),
}));

function textProps(element: Parameters<typeof create>[0]) {
    let renderer: ReactTestRenderer;
    act(() => {
        renderer = create(element);
    });
    return renderer!.root.find(node => (node.type as unknown) === Text).props;
}

it("keeps a fixed size on pages that have not been migrated", () => {
    expect(textProps(<ThemeText>歌名</ThemeText>).allowFontScaling).toBe(false);
});

it("follows the system font inside a migrated page or panel", () => {
    expect(
        textProps(
            <FontScaleScope followSystem>
                <ThemeText>歌名</ThemeText>
            </FontScaleScope>,
        ).allowFontScaling,
    ).toBe(true);
    expect(
        textProps(
            <FontScaleScope followSystem={false}>
                <ThemeText>歌名</ThemeText>
            </FontScaleScope>,
        ).allowFontScaling,
    ).toBe(false);
});

it("lets a text opt out, or cap the scale like a compact control", () => {
    const optedOut = textProps(
        <FontScaleScope followSystem>
            <ThemeText allowFontScaling={false}>歌名</ThemeText>
        </FontScaleScope>,
    );
    expect(optedOut.allowFontScaling).toBe(false);

    const capped = textProps(
        <FontScaleScope followSystem>
            <ThemeText maxFontSizeMultiplier={1.5}>歌名</ThemeText>
        </FontScaleScope>,
    );
    expect(capped.allowFontScaling).toBe(true);
    expect(capped.maxFontSizeMultiplier).toBe(1.5);
});
