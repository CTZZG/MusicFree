import type { PlayerBackendState } from "@/core/playerAdapter";

type MusicStateLike =
    | PlayerBackendState
    | { state?: PlayerBackendState | null }
    | null
    | undefined;

export function normalizeMusicState(state: MusicStateLike): PlayerBackendState {
    const rawState =
        state && typeof state === "object" && "state" in state
            ? state.state
            : state;

    switch (rawState) {
        case "playing":
            return "playing";
        case "paused":
            return "paused";
        case "buffering":
            return "buffering";
        case "stopped":
            return "stopped";
        case "ended":
            return "ended";
        case "ready":
            return "ready";
        case "error":
            return "error";
        case "idle":
        default:
            return "idle";
    }
}

/**
 * 音乐是否处于停止状态
 * @param state
 * @returns
 */
export const musicIsPaused = (state: MusicStateLike) =>
    normalizeMusicState(state) !== "playing";

/**
 * 音乐是否处于缓冲中状态
 * @param state
 * @returns
 */
export const musicIsBuffering = (state: MusicStateLike) =>
    normalizeMusicState(state) === "buffering";
