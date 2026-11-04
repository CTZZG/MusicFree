import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import SeekBar from "../seekBar";
let mockState: any;
let mockOwner: any;
let mockDuration = 48;
const mockSeek = jest.fn();
jest.mock("@react-native-community/slider", () => "Slider");
jest.mock("@/core/trackPlayer", () => ({ __esModule: true, default: {
    seekTo: (position: number) => mockSeek(position), playerAdapter: { getRenditionOwner: () => mockOwner },
}, useMusicVideoState: () => mockState, useCurrentMusic: () => ({ id: "a", platform: "p", duration: 480 }),
useMusicQuality: () => "128k", useProgress: () => ({ position: 6, duration: mockDuration }) }));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));
jest.mock("@/utils/persistStatus", () => ({ __esModule: true, default: { useValue: () => 150 } }));
jest.mock("@/utils/qualities", () => ({ getQualityAbbr: () => "128k" }));
jest.mock("@/utils/toast", () => ({ __esModule: true, default: { warn: jest.fn() } }));
let tree: ReactTestRenderer;
const slider = () => tree.root.findByType("Slider" as any);
async function mount() {
    await act(async () => {
        tree = create(<SeekBar />);
    });
}
beforeEach(() => {
    jest.clearAllMocks(); mockDuration = 48; mockOwner = { kind: "mv", mediaId: "p@a", loadGeneration: 2 };
    mockState = { phase: "video", owner: mockOwner, video: { qualities: [{ id: "720p", label: "720p" }], qualityId: "720p" } };
});
afterEach(() => act(() => tree?.unmount()));

test("unknown MV duration disables seek instead of inheriting the 480-second song", async () => {
    mockDuration = 0; await mount(); expect(slider().props.disabled).toBe(true); expect(slider().props.maximumValue).toBe(1);
    const text = tree.root.findAll(node => typeof node.props.children === "string").map(node => node.props.children).join("\n");
    expect(text).not.toContain("1.5x"); expect(text).toContain("MV 720p");
});

test("a drag begun on one rendition cannot seek a replacement generation", async () => {
    await mount(); act(() => slider().props.onSlidingStart());
    mockOwner = { ...mockOwner, loadGeneration: 3 }; mockState = { ...mockState, owner: mockOwner };
    await act(async () => tree.update(<SeekBar />)); act(() => slider().props.onSlidingComplete(12));
    expect(mockSeek).not.toHaveBeenCalled();
});

test("a current MV drag uses the existing player seek and preserves the existing end guard", async () => {
    await mount(); act(() => slider().props.onSlidingStart()); act(() => slider().props.onSlidingComplete(48));
    expect(mockSeek).toHaveBeenCalledWith(46);
});
