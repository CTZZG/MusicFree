import type { MusicVideoState } from "../musicVideoController";
import { describeMusicVideoView } from "../musicVideoView";

const phases = ["audio", "resolving", "loading", "video", "returning", "error"] as const;
const owners = ["mv", "audio", null] as const;

describe("music video presentation", () => {
    test.each(phases.flatMap(phase => owners.map(owner => [phase, owner] as const)))(
        "%s with %s owner",
        (phase, kind) => {
            const state = {
                phase,
                songKey: "test@a",
                owner: kind ? { kind, mediaId: "test@a", loadGeneration: 1 } : undefined,
                video: { id: "clip", title: "Video", artist: "Artist", providerName: "test" },
                canReturn: true,
                error: phase === "audio" ? "activation" : undefined,
            } as MusicVideoState;
            const view = describeMusicVideoView(state);
            const engineIsVideo = phase !== "audio" && kind === "mv";
            expect(view.state).toBe(state);
            expect(view.engineIsVideo).toBe(engineIsVideo);
            expect(view.videoMode).toBe(engineIsVideo || phase === "returning" || phase === "error");
            expect(view.transitioning).toBe(phase === "loading" || phase === "returning");
            if (phase === "audio") expect(view.error).toBe("activation");
        },
    );
});
