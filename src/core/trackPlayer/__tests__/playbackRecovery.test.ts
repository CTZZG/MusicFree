import { createPlaybackRecovery } from "../playbackRecovery";
import { createMediaSourceFailure } from "@/core/pluginManager/mediaSourceFailure";

const song = { id: "1", platform: "source", title: "Song", artist: "Artist", album: "Album", artwork: "", duration: 180 };
const failure = createMediaSourceFailure("network-error");

describe("playback failure ownership", () => {
    it("keeps a failure until a user action and clears it on a new play request", () => {
        const recovery = createPlaybackRecovery();
        const request = recovery.begin();
        expect(recovery.report(request, song, failure)).toBe(true);
        expect(recovery.state.getValue()?.musicItem).toBe(song);
        recovery.begin();
        expect(recovery.state.getValue()).toBeNull();
    });

    it("does not resurrect a failed track after the user starts another request", () => {
        const recovery = createPlaybackRecovery();
        const old = recovery.begin();
        const current = recovery.begin();
        recovery.report(current, song, failure);
        const notice = recovery.state.getValue();
        expect(recovery.report(old, { ...song, id: "old" }, failure)).toBe(false);
        expect(recovery.state.getValue()).toBe(notice);
    });

    it("an old panel action cannot dismiss or retry a newer failure", () => {
        const recovery = createPlaybackRecovery();
        const request = recovery.begin();
        recovery.report(request, song, failure);
        const id = recovery.state.getValue()!.id;
        recovery.report(request, { ...song, id: "2" }, failure);
        expect(recovery.dismiss(id)).toBe(false);
        expect(recovery.state.getValue()?.musicItem.id).toBe("2");
        expect(recovery.dismiss(recovery.state.getValue()!.id)).toBe(true);
        expect(recovery.dismiss(id)).toBe(false);
    });
});
