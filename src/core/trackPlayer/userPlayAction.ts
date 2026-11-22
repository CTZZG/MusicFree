import { AppState } from "react-native";
import TrackPlayer from "@/core/trackPlayer";

/** Main and remote play share MV consent when the app can present dialogs. */
export async function playCurrentMusic() {
    const state = TrackPlayer.musicVideoState;
    if (AppState.currentState === "active" && state?.phase !== "audio" &&
        state?.phase !== "returning" && state?.owner?.kind === "mv") {
        const { resumeMusicVideo } = require("@/components/musicVideo/actions") as typeof import("@/components/musicVideo/actions");
        await resumeMusicVideo();
        return;
    }
    await TrackPlayer.play();
}
