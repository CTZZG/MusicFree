import type { MusicVideoState } from "./musicVideoController";

/** Presentation decisions derived from the controller's immutable state. */
export function describeMusicVideoView(state: MusicVideoState) {
    if (state.phase === "audio") {
        return {
            state,
            video: null,
            owner: null,
            error: state.error,
            engineIsVideo: false,
            videoMode: false,
            transitioning: false,
        };
    }
    const owner = state.owner ?? null;
    const engineIsVideo = owner?.kind === "mv";
    const returning = state.phase === "returning";
    return {
        state,
        video: state.video,
        owner,
        error: state.error,
        engineIsVideo,
        videoMode: engineIsVideo || returning || state.phase === "error",
        transitioning: state.phase === "loading" || returning,
    };
}
