import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import LyricTools from "../lyricTools";
import LyricOperations from "@/pages/musicDetail/components/content/lyric/lyricOperations";
import PersistStatus from "@/utils/persistStatus";
import { showPanel } from "../../usePanel";

jest.mock("@/core/lyricManager", () => ({
    __esModule: true,
    default: { updateLyricOffset: jest.fn() },
    useLyricState: () => ({ hasTranslation: true, hasRomanization: false }),
}));
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: { currentMusic: { id: "one", platform: "source" } },
}));
jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: { useValue: (_key: string, fallback: unknown) => fallback, set: jest.fn() },
}));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ placeholder: "#eee", primary: "blue" }),
}));
jest.mock("@/hooks/useOrientation", () => ({
    __esModule: true,
    default: () => "vertical",
}));
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("@/components/base/icon", () => "Icon");
jest.mock("@/assets/icons/translation.svg", () => "Translation");
jest.mock("@/pages/musicDetail/components/content/heartIcon", () => "Heart");
jest.mock("../../base/panelBase", () => ({
    __esModule: true,
    default: (p: any) => p.renderBody(),
}));
jest.mock("../../base/panelHeader", () => () => null);
jest.mock("../../usePanel", () => ({ showPanel: jest.fn(), hidePanel: jest.fn() }));

it("preserves font/translation controls and routes less-used controls through the real tools panel", () => {
    let tree!: ReactTestRenderer;
    const changed = jest.fn();
    const button = (label: string) =>
        tree.root.findAll(
            node =>
                node.props.accessibilityLabel === label &&
                typeof node.props.onPress === "function",
        )[0];
    act(() => {
        tree = create(<LyricOperations scrollToCurrentLrcItem={changed} />);
    });
    act(() => button("lyricTools.translation").props.onPress());
    expect(PersistStatus.set).toHaveBeenCalledWith("lyric.showTranslation", true);
    act(() => button("panel.setFontSize.title").props.onPress());
    expect(showPanel).toHaveBeenLastCalledWith(
        "SetFontSize",
        expect.objectContaining({ onSelectChange: expect.any(Function) }),
    );
    act(() => button("lyricTools.title").props.onPress());
    const payload = (showPanel as jest.Mock).mock.calls.at(-1)[1];
    act(() => tree.update(<LyricTools {...payload} />));
    const focus = tree.root.findAll(
        node =>
            node.props.accessibilityLabel === "lyricTools.focus" &&
            typeof node.props.onValueChange === "function",
    )[0];
    act(() => focus.props.onValueChange(true));
    expect(PersistStatus.set).toHaveBeenCalledWith("lyric.detailAmlLiteMode", true);
    const romanization = tree.root.findAll(
        node =>
            node.props.accessibilityLabel === "lyricTools.romanization" &&
            typeof node.props.onValueChange === "function",
    )[0];
    expect(romanization.props.disabled).toBe(true);
    act(() => button("lyricTools.search").props.onPress());
    expect(showPanel).toHaveBeenLastCalledWith("SearchLrc", {
        musicItem: payload.musicItem,
    });
    act(() => button("shareCard.title").props.onPress());
    expect(showPanel).toHaveBeenLastCalledWith("MusicShare", {
        musicItem: payload.musicItem,
    });
    act(() => tree.unmount());
});
