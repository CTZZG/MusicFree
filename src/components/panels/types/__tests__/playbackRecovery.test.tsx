import React from "react";
import renderer, { act } from "react-test-renderer";
import PlaybackRecovery from "../playbackRecovery";
import { playbackRecovery } from "@/core/trackPlayer/playbackRecovery";
import { createMediaSourceFailure } from "@/core/pluginManager/mediaSourceFailure";
import TrackPlayer from "@/core/trackPlayer";
import { showPanel } from "../../usePanel";

jest.mock("@/core/trackPlayer", () => ({ __esModule: true, default: { retryPlayback: jest.fn() } }));
jest.mock("@/core/router", () => ({ useNavigate: () => jest.fn(), navigateToSearch: jest.fn(), ROUTE_PATH: { SETTING: "setting" } }));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
jest.mock("../../usePanel", () => ({ hidePanel: jest.fn(), showPanel: jest.fn() }));
jest.mock("../../base/panelBase", () => (props: any) => props.renderBody());
jest.mock("../../base/panelHeader", () => () => null);
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("react-native-gesture-handler", () => ({ ScrollView: "ScrollView" }));

const song: IMusic.IMusicItem = { id: "1", platform: "Source", title: "Song", artist: "Artist", album: "", artwork: "", duration: 180 };
let tree: renderer.ReactTestRenderer;
function mountFailure() {
    playbackRecovery.report(playbackRecovery.begin(), song, createMediaSourceFailure("network-error"));
    const notice = playbackRecovery.state.getValue()!;
    act(() => {
        tree = renderer.create(<PlaybackRecovery notice={notice} />);
    });
}
function press(label: string) {
    const text = tree.root.findAll(node => (node.type as unknown) === "Text" && node.props.children === label)[0];
    let button = text.parent;
    while (button && typeof button.props.onPress !== "function") {
        button = button.parent;
    }
    expect(button).not.toBeNull();
    act(() => button!.props.onPress());
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
    act(() => tree?.unmount()); playbackRecovery.begin();
});

it("retries the failed song rather than the track retained by a native rollback", () => {
    mountFailure();
    press("common.retry");
    expect(TrackPlayer.retryPlayback).toHaveBeenCalledWith(song);
    expect(playbackRecovery.state.getValue()).toBeNull();
});

it("passes an explicit selected quality to the failed-song retry", () => {
    mountFailure();
    press("playbackRecovery.chooseQuality");
    expect(showPanel).toHaveBeenCalledWith("MusicQuality", expect.objectContaining({ musicItem: song }));
    const payload = (showPanel as jest.Mock).mock.calls[0][1];
    payload.onQualityPress("128k");
    expect(TrackPlayer.retryPlayback).toHaveBeenCalledWith(song, "128k");
});

it("cannot revive an old failure after a newer play request starts", () => {
    mountFailure();
    press("playbackRecovery.chooseQuality");
    const payload = (showPanel as jest.Mock).mock.calls[0][1];
    playbackRecovery.begin();
    payload.onQualityPress("128k");
    expect(TrackPlayer.retryPlayback).not.toHaveBeenCalled();
});
