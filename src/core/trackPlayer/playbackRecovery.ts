import { GlobalState } from "@/utils/stateMapper";
import type { MediaSourceFailure } from "@/core/pluginManager/mediaSourceFailure";

export interface PlaybackFailureNotice {
    id: number;
    musicItem: IMusic.IMusicItem;
    failure: MediaSourceFailure;
}

/** A late failure must not replace the result of a newer user action. */
export function createPlaybackRecovery() {
    const state = new GlobalState<PlaybackFailureNotice | null>(null);
    let request = 0;
    let notice = 0;
    return {
        state,
        currentRequest: () => request,
        begin() {
            request += 1;
            state.setValue(null);
            return request;
        },
        report(owner: number, musicItem: IMusic.IMusicItem, failure: MediaSourceFailure) {
            if (owner !== request) {
                return false;
            }
            state.setValue({ id: ++notice, musicItem, failure });
            return true;
        },
        dismiss(id: number) {
            if (state.getValue()?.id !== id) {
                return false;
            }
            state.setValue(null);
            return true;
        },
    };
}

export const playbackRecovery = createPlaybackRecovery();
